/**
 * backend/routes/changeRoutes.js
 *
 * M4 Task 4.7: File-Change Monitoring & SENTINEL Change Window Matching
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const postgres = require('../../database/postgres');
const eventStore = require('../../database/event_store');
const clickhouse = require('../../database/clickhouse');
const { requireIngestKey } = require('../auth/ingest_keys');
const { requireRole, SRE_LEAD_PLUS } = require('../auth/require_role');
const { auditLog } = require('../audit_logger');
const { requestEnvironment } = require('./_prototype');

const MAX_EVENTS_PER_REQUEST = 1000;

// [Phase S1] Change windows live only in PostgreSQL (no memory-only windows: a window
// that disappears on restart would silently turn approved changes into alerts).
// setPool() lets tests inject a pool: undefined = the real pool, null = none.
let poolOverride;
// Overrides the PostgreSQL pool (tests).
function setPool(pool) {
  poolOverride = pool;
}

// Runs a query on PostgreSQL, or returns null without a database.
async function pgQuery(sql, params) {
  if (poolOverride === null) return null;
  if (poolOverride) return poolOverride.query(sql, params);
  return postgres.query(sql, params);
}

/**
 * Check if a timestamp falls within an approved (not closed) change window.
 * Returns { approved: false } when PostgreSQL is not configured or unreachable.
 */
async function isWithinChangeWindow({ environment, productId, host, timestamp }) {
  const ts = new Date(timestamp || Date.now());
  const env = environment || 'staging';
  try {
    const res = await pgQuery(
      `SELECT * FROM change_window
       WHERE (environment = $1 OR environment = 'all')
         AND status <> 'CLOSED'
         AND start_time <= $2 AND end_time >= $2
         AND (product_id IS NULL OR $3::text IS NULL OR product_id = $3)
         AND (host IS NULL OR $4::text IS NULL OR host = $4)
       ORDER BY start_time DESC
       LIMIT 1`,
      [env, ts.toISOString(), productId || null, host || null]
    );
    const rows = res && Array.isArray(res.rows) ? res.rows : [];
    if (rows.length > 0) return { approved: true, window: rows[0] };
  } catch (_) {}
  return { approved: false, window: null };
}

/**
 * Record a file change event and evaluate change window approval.
 */
async function recordFileChangeEvent({
  environment = 'staging',
  productId = null,
  host = null,
  path: filePath,
  beforeHash = null,
  afterHash = null,
  user = null,
  process: processName = null,
  action = null,
  category = null,
  timestamp = null
}) {
  const eventTs = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  const { approved, window } = await isWithinChangeWindow({
    environment,
    productId,
    host,
    timestamp: eventTs
  });

  const where = host || 'unknown host';
  const title = approved
    ? `Approved file change: ${filePath} on ${where}`
    : `UNAPPROVED file change: ${filePath} on ${where}`;

  const severity = approved ? 'info' : 'warning';
  const payload = {
    path: filePath,
    before_hash: beforeHash,
    after_hash: afterHash,
    user,
    process: processName,
    action,
    category,
    is_approved: approved,
    window_id: window ? window.id : null
  };

  // Persist to Postgres event store and ClickHouse
  const eventRecord = {
    timestamp: eventTs,
    entity_id: productId ? `product:${productId}` : `host:${host || 'unknown'}`,
    kind: 'file_change',
    severity,
    title,
    payload,
    environment,
    source: 'osquery'
  };

  try {
    await eventStore.recordEvent(eventRecord);
  } catch (_) {}

  if (clickhouse.isConfigured()) {
    clickhouse.insertEvents([eventRecord]).catch(() => {});
  }

  return {
    ...eventRecord,
    is_approved: approved
  };
}

// GET /api/v2/changes/windows  (environment from the session)
router.get('/windows', async (req, res) => {
  const env = requestEnvironment(req);
  try {
    const r = await pgQuery(
      `SELECT * FROM change_window WHERE environment = $1 OR environment = 'all' ORDER BY start_time DESC LIMIT 200`,
      [env]
    );
    if (!r) {
      return res.json({ status: 'DATA_UNAVAILABLE', environment: env, reason: 'PostgreSQL is not configured; change windows need it.', windows: [] });
    }
    return res.json({ environment: env, windows: r.rows || [] });
  } catch (err) {
    return res.status(503).json({ status: 'DATA_UNAVAILABLE', environment: env, error: `Could not read change windows: ${err.message}`, windows: [] });
  }
});

// POST /api/v2/changes/windows  (SRE Lead+; environment and creator from the session)
router.post('/windows', requireRole(SRE_LEAD_PLUS), async (req, res) => {
  const { title, description, productId, host, startTime, endTime } = req.body || {};
  if (!title || !startTime || !endTime) {
    return res.status(400).json({ error: 'title, startTime, and endTime are required' });
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'startTime and endTime must be valid dates with endTime after startTime' });
  }

  const windowObj = {
    id: 'CW-' + crypto.randomUUID().substring(0, 8).toUpperCase(),
    title: String(title).slice(0, 255),
    description: description ? String(description) : '',
    environment: requestEnvironment(req),
    product_id: productId || null,
    host: host || null,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    created_by: req.user.username,
    status: 'SCHEDULED'
  };

  let r;
  try {
    r = await pgQuery(
      `INSERT INTO change_window (id, title, description, environment, product_id, host, start_time, end_time, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [windowObj.id, windowObj.title, windowObj.description, windowObj.environment, windowObj.product_id, windowObj.host, windowObj.start_time, windowObj.end_time, windowObj.created_by, windowObj.status]
    );
  } catch (err) {
    return res.status(503).json({ error: `Change window not saved: ${err.message}` });
  }
  if (!r) {
    return res.status(503).json({ error: 'Change window not saved: PostgreSQL is not configured.' });
  }
  const saved = (r.rows && r.rows[0]) || windowObj;
  auditLog(req, 'CHANGE_WINDOW_CREATE', { id: saved.id, environment: saved.environment, product_id: saved.product_id, host: saved.host, start_time: windowObj.start_time, end_time: windowObj.end_time });
  res.status(201).json({ status: 'SUCCESS', window: saved });
});

// POST /api/v2/changes/windows/:id/close  (SRE Lead+; only windows of the session's environment)
router.post('/windows/:id/close', requireRole(SRE_LEAD_PLUS), async (req, res) => {
  const env = requestEnvironment(req);
  let r;
  try {
    r = await pgQuery(
      `UPDATE change_window
          SET status = 'CLOSED', end_time = LEAST(end_time, now()), closed_by = $3, closed_at = now()
        WHERE id = $1 AND environment = $2 AND status <> 'CLOSED'
        RETURNING *`,
      [req.params.id, env, req.user.username]
    );
  } catch (err) {
    return res.status(503).json({ error: `Change window not closed: ${err.message}` });
  }
  if (!r) return res.status(503).json({ error: 'Change window not closed: PostgreSQL is not configured.' });
  if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'No open change window with that id in this environment.' });
  auditLog(req, 'CHANGE_WINDOW_CLOSE', { id: req.params.id, environment: env });
  res.json({ status: 'SUCCESS', window: r.rows[0] });
});

// POST /api/v2/changes/events (sentinel-probe forwarding osquery file events)
// Ingest key with scope `agent` (X-Sentinel-Api-Key); a browser session is not enough.
// The environment comes only from the key. Body: one event or { events: [...] }.
router.post('/events', requireIngestKey('agent'), async (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.events) ? body.events : [body];
  if (list.length === 0 || list.length > MAX_EVENTS_PER_REQUEST) {
    return res.status(400).json({ error: `1 to ${MAX_EVENTS_PER_REQUEST} events per request` });
  }
  if (list.some(e => !e || typeof e.path !== 'string' || !e.path)) {
    return res.status(400).json({ error: 'path is required on every event' });
  }
  const environment = req.ingestEnv || 'staging';
  const stored = [];
  for (const e of list) {
    stored.push(await recordFileChangeEvent({
      environment,
      productId: e.productId || e.product_id || null,
      host: e.host || null,
      path: e.path,
      beforeHash: e.beforeHash || null,
      afterHash: e.afterHash || null,
      user: e.user || null,
      process: e.process || null,
      action: e.action || null,
      category: e.category || null,
      timestamp: e.timestamp || null
    }));
  }
  if (Array.isArray(body.events)) {
    return res.status(201).json({ status: 'SUCCESS', count: stored.length, events: stored });
  }
  res.status(201).json({ status: 'SUCCESS', event: stored[0] });
});

module.exports = {
  router,
  setPool,
  isWithinChangeWindow,
  recordFileChangeEvent
};
