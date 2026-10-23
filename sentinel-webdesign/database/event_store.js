/**
 * Event and RCA-hypothesis store (PostgreSQL / ClickHouse, with an in-memory buffer).
 */
const crypto = require('crypto');
const postgres = require('./postgres');
const clickhouse = require('./clickhouse');

const MAX_EVENT_BUFFER = 20000;
const MAX_HYPOTHESIS_BUFFER = 500;

let inMemoryEvents = [];
let inMemoryHypotheses = [];

// New event id.
function generateEventId() {
  return 'evt-' + crypto.randomUUID();
}

/**
 * Normalizes an event item into standard shape.
 */
function normalizeEvent(raw) {
  if (!raw) return null;
  const now = new Date().toISOString();
  const payload = raw.payload || raw.details || {};
  return {
    event_id: raw.event_id || raw.id || generateEventId(),
    ts: raw.ts || raw.timestamp || now,
    entity_id: raw.entity_id || raw.entityId || null,
    kind: raw.kind || raw.trackId || 'metric_anomaly',
    severity: (raw.severity || 'warning').toLowerCase(),
    title: raw.title || 'System Event',
    summary: raw.summary || '',
    payload,
    details: payload,
    environment: (raw.environment || raw.env || 'staging').toLowerCase(),
    source: raw.source || 'pipeline'
  };
}

/**
 * Adds an event to the normalized store.
 */
async function addEvent(event) {
  const norm = normalizeEvent(event);
  if (!norm) return null;

  inMemoryEvents.push(norm);
  if (inMemoryEvents.length > MAX_EVENT_BUFFER) {
    inMemoryEvents = inMemoryEvents.slice(inMemoryEvents.length - MAX_EVENT_BUFFER);
  }

  try {
    const pool = await postgres.getPool();
    if (pool) {
      await pool.query(`
        INSERT INTO event (event_id, ts, entity_id, kind, severity, title, summary, payload, environment, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (event_id) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        payload = EXCLUDED.payload;
      `, [
        norm.event_id,
        new Date(norm.ts),
        norm.entity_id,
        norm.kind,
        norm.severity,
        norm.title,
        norm.summary,
        JSON.stringify(norm.payload),
        norm.environment,
        norm.source
      ]);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[EVENT_STORE] PostgreSQL event insert failed (${err.message}). Cached in ring buffer.`);
    }
  }

  if (clickhouse && clickhouse.isConfigured()) {
    try {
      await clickhouse.insertEvents([{
        ts: norm.ts,
        env: norm.environment,
        entity_id: norm.entity_id,
        kind: norm.kind,
        severity: norm.severity,
        title: norm.title,
        summary: norm.summary,
        payload: norm.payload,
        source: norm.source
      }]);
    } catch (chErr) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[EVENT_STORE] ClickHouse event insert failed (${chErr.message}).`);
      }
    }
  }

  return norm;
}

/**
 * Adds a batch of events.
 */
async function addEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const added = [];
  for (const e of events) {
    const res = await addEvent(e);
    if (res) added.push(res);
  }
  return added;
}

/**
 * Queries events with time bounds and optional filters.
 */
async function getEvents(filters = {}) {
  const { from, to, kind, entity_id, environment, limit = 100 } = filters;
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);

  // Attempt Postgres query
  try {
    const pool = await postgres.getPool();
    if (pool) {
      const conditions = [];
      const params = [];
      let pIdx = 1;

      if (from) {
        conditions.push(`ts >= $${pIdx}`);
        params.push(new Date(from));
        pIdx++;
      }
      if (to) {
        conditions.push(`ts <= $${pIdx}`);
        params.push(new Date(to));
        pIdx++;
      }
      if (environment) {
        conditions.push(`environment = $${pIdx}`);
        params.push(environment.toLowerCase());
        pIdx++;
      }
      if (kind) {
        conditions.push(`kind = $${pIdx}`);
        params.push(kind);
        pIdx++;
      }
      if (entity_id) {
        conditions.push(`entity_id = $${pIdx}`);
        params.push(entity_id);
        pIdx++;
      }

      params.push(parsedLimit);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT event_id, ts, entity_id, kind, severity, title, summary, payload, environment, source
        FROM event
        ${whereClause}
        ORDER BY ts DESC
        LIMIT $${pIdx}
      `;
      const res = await pool.query(query, params);
      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts
        }));
      }
    }
  } catch (_) {}

  // Fallback to in-memory store
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs = to ? new Date(to).getTime() : Infinity;

  let results = inMemoryEvents.filter(e => {
    const t = new Date(e.ts).getTime();
    if (t < fromMs || t > toMs) return false;
    if (environment && e.environment !== environment.toLowerCase()) return false;
    if (kind && e.kind !== kind) return false;
    if (entity_id && e.entity_id !== entity_id) return false;
    return true;
  });

  results.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return results.slice(0, parsedLimit);
}

/**
 * Saves or updates an RCA hypothesis.
 */
async function saveHypothesis(hypothesis) {
  if (!hypothesis) return null;
  const id = hypothesis.hypothesis_id || hypothesis.id || ('hypo-' + crypto.randomUUID());
  const now = new Date().toISOString();

  const record = {
    hypothesis_id: id,
    created_at: hypothesis.created_at || now,
    trigger_event_id: hypothesis.trigger_event_id || 'manual-trigger',
    suspect_entity_id: hypothesis.suspect_entity_id || hypothesis.suspectEntityId || 'unknown',
    confidence: Number(hypothesis.confidence) || 0.5,
    blast_radius: Number(hypothesis.blast_radius || hypothesis.blastRadius) || 1,
    rationale: hypothesis.rationale || [],
    environment: (hypothesis.environment || 'staging').toLowerCase(),
    status: hypothesis.status || 'open',
    verdicts: hypothesis.verdicts || []
  };

  const existingIdx = inMemoryHypotheses.findIndex(h => h.hypothesis_id === id);
  if (existingIdx !== -1) {
    inMemoryHypotheses[existingIdx] = record;
  } else {
    inMemoryHypotheses.push(record);
    if (inMemoryHypotheses.length > MAX_HYPOTHESIS_BUFFER) {
      inMemoryHypotheses = inMemoryHypotheses.slice(inMemoryHypotheses.length - MAX_HYPOTHESIS_BUFFER);
    }
  }

  try {
    const pool = await postgres.getPool();
    if (pool) {
      await pool.query(`
        INSERT INTO rca_hypothesis (
          hypothesis_id, created_at, trigger_event_id, suspect_entity_id, confidence, blast_radius, rationale, environment, status, verdicts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (hypothesis_id) DO UPDATE SET
          confidence = EXCLUDED.confidence,
          blast_radius = EXCLUDED.blast_radius,
          rationale = EXCLUDED.rationale,
          status = EXCLUDED.status,
          verdicts = EXCLUDED.verdicts;
      `, [
        record.hypothesis_id,
        new Date(record.created_at),
        record.trigger_event_id,
        record.suspect_entity_id,
        record.confidence,
        record.blast_radius,
        JSON.stringify(record.rationale),
        record.environment,
        record.status,
        JSON.stringify(record.verdicts)
      ]);
    }
  } catch (_) {}

  return record;
}

/**
 * Retrieves hypotheses for an environment.
 */
async function getHypotheses(filters = {}) {
  const { environment, status, from, to, limit = 50 } = filters;
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  try {
    const pool = await postgres.getPool();
    if (pool) {
      const conditions = [];
      const params = [];
      let pIdx = 1;

      if (environment) {
        conditions.push(`environment = $${pIdx}`);
        params.push(environment.toLowerCase());
        pIdx++;
      }
      if (status) {
        conditions.push(`status = $${pIdx}`);
        params.push(status);
        pIdx++;
      }
      if (from) {
        conditions.push(`created_at >= $${pIdx}`);
        params.push(new Date(from));
        pIdx++;
      }
      if (to) {
        conditions.push(`created_at <= $${pIdx}`);
        params.push(new Date(to));
        pIdx++;
      }

      params.push(parsedLimit);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT hypothesis_id, created_at, trigger_event_id, suspect_entity_id, confidence, blast_radius, rationale, environment, status, verdicts
        FROM rca_hypothesis
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${pIdx}
      `;
      const res = await pool.query(query, params);
      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
        }));
      }
    }
  } catch (_) {}

  let results = inMemoryHypotheses.filter(h => {
    if (environment && h.environment !== environment.toLowerCase()) return false;
    if (status && h.status !== status) return false;
    if (from && new Date(h.created_at) < new Date(from)) return false;
    if (to && new Date(h.created_at) > new Date(to)) return false;
    return true;
  });

  if (environment && environment.toLowerCase() === 'demo' && results.length === 0) {
    results = [
      {
        hypothesis_id: 'hyp-demo-nas-01',
        created_at: new Date().toISOString(),
        trigger_event_id: 'evt-demo-01',
        suspect_entity_id: 'infra:nas_performance',
        confidence: 0.94,
        blast_radius: 4,
        rationale: [
          { claim: 'Shared NAS storage queue saturation detected on /mnt/production_shares.' },
          { observation: 'Correlated latency spike across Bitbucket git-pack and Artifactory binary upload within 3 minutes.' }
        ],
        environment: 'demo',
        status: 'open',
        verdicts: []
      }
    ];
  }

  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results.slice(0, parsedLimit);
}

/**
 * Gets a single hypothesis by ID.
 */
async function getHypothesisById(id) {
  if (!id) return null;
  const inMem = inMemoryHypotheses.find(h => h.hypothesis_id === id);
  if (inMem) return inMem;

  try {
    const pool = await postgres.getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM rca_hypothesis WHERE hypothesis_id = $1', [id]);
      if (res.rows && res.rows.length > 0) {
        const r = res.rows[0];
        return {
          ...r,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
        };
      }
    }
  } catch (_) {}

  if (id === 'hyp-demo-nas-01') {
    return {
      hypothesis_id: 'hyp-demo-nas-01',
      created_at: new Date().toISOString(),
      trigger_event_id: 'evt-demo-01',
      suspect_entity_id: 'infra:nas_performance',
      confidence: 0.94,
      blast_radius: 4,
      rationale: [
        { claim: 'Shared NAS storage queue saturation detected on /mnt/production_shares.' },
        { observation: 'Correlated latency spike across Bitbucket git-pack and Artifactory binary upload within 3 minutes.' }
      ],
      environment: 'demo',
      status: 'open',
      verdicts: []
    };
  }

  return null;
}

/**
 * Records an operator feedback verdict on an RCA hypothesis (T4.4).
 * 
 * @param {string} hypothesisId
 * @param {string} verdict - 'confirmed' | 'rejected'
 * @param {string} user
 * @param {string} notes
 */
async function recordVerdict(hypothesisId, verdict, user = 'operator', notes = '') {
  const normVerdict = (verdict || '').toLowerCase();
  if (normVerdict !== 'confirmed' && normVerdict !== 'rejected') {
    throw new Error('Verdict must be "confirmed" or "rejected"');
  }

  const hypothesis = await getHypothesisById(hypothesisId);
  if (!hypothesis) {
    throw new Error(`Hypothesis "${hypothesisId}" not found`);
  }

  const verdictRecord = {
    verdict: normVerdict,
    user,
    operator: user,
    timestamp: new Date().toISOString(),
    notes
  };

  hypothesis.verdicts = hypothesis.verdicts || [];
  hypothesis.verdicts.push(verdictRecord);
  hypothesis.status = normVerdict === 'confirmed' ? 'confirmed' : 'rejected';

  return saveHypothesis(hypothesis);
}

// Clears the in-memory buffers.
function clearMemoryStore() {
  inMemoryEvents = [];
  inMemoryHypotheses = [];
}

module.exports = {
  addEvent,
  addEvents,
  getEvents,
  saveHypothesis,
  getHypotheses,
  getHypothesisById,
  recordVerdict,
  clearMemoryStore
};
