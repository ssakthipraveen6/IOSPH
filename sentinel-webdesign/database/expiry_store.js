/**
 * database/expiry_store.js
 *
 * Real TLS, Secret, and License Expiry Datastore (Phase 5 / Phase O7).
 * Supports PostgreSQL and ClickHouse persistence with in-memory fallback,
 * real TLS peer socket probing via tls.connect(), dynamic daysLeft calculation,
 * and multi-location de-duplication by fingerprint.
 */

const tls = require('tls');
const crypto = require('crypto');
const postgres = require('./postgres');
let clickhouse = null;
try {
  clickhouse = require('./clickhouse');
} catch (_) {
  clickhouse = null;
}

let inMemoryExpiryItems = new Map();

/**
 * Calculates daysLeft dynamically from not_after timestamp.
 */
function calculateDaysLeft(notAfter, nowMs = Date.now()) {
  if (!notAfter) return null;
  const expiryDate = new Date(notAfter).getTime();
  const diffDays = Math.floor((expiryDate - nowMs) / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Resolves item status ('healthy', 'info', 'warning', 'critical') based on dynamic daysLeft.
 * Phase O7 rules:
 * - <= 7 days: critical (EMERGENCY)
 * - <= 14 days: critical
 * - <= 30 days: warning
 * - <= 60 days: info
 * - > 60 days: healthy
 */
function resolveStatus(daysLeft, warningDays = 30, criticalDays = 14) {
  if (daysLeft === null || daysLeft === undefined) return 'unknown';
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= criticalDays) return 'critical';
  if (daysLeft <= warningDays) return 'warning';
  if (daysLeft <= 60) return 'info';
  return 'healthy';
}

// Stable id for an expiry item.
function computeFingerprint(item) {
  if (item.fingerprint) return item.fingerprint;
  if (item.item_id) return item.item_id;
  const str = `${item.kind || 'tls_cert'}:${item.subject || item.name || ''}:${item.issuer || ''}:${item.not_after || ''}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

/**
 * Saves or updates an expiry item.
 * De-duplicates by fingerprint and merges locations and flags.
 */
async function upsertExpiryItem(item, nowMs = Date.now()) {
  if (!item) return null;

  const fingerprint = computeFingerprint(item);
  const existing = inMemoryExpiryItems.get(fingerprint);

  const locs = new Set(existing ? (existing.locations || []) : []);
  if (item.target) locs.add(item.target);
  if (item.location) locs.add(item.location);
  if (Array.isArray(item.locations)) {
    for (const l of item.locations) if (l) locs.add(l);
  }
  if (locs.size === 0) locs.add('localhost');

  const flagsSet = new Set(existing ? (existing.flags || []) : []);
  if (Array.isArray(item.flags)) {
    for (const f of item.flags) if (f) flagsSet.add(f);
  }
  if (item.flag) flagsSet.add(item.flag);

  const notAfter = item.not_after ? new Date(item.not_after).toISOString() : (existing?.not_after || null);
  const daysLeft = calculateDaysLeft(notAfter, nowMs);

  const record = {
    fingerprint,
    item_id: fingerprint,
    entity_id: item.entity_id || existing?.entity_id || null,
    kind: item.kind || existing?.kind || 'tls_cert',
    subject: item.subject || item.name || existing?.subject || existing?.name || fingerprint,
    name: item.name || item.subject || existing?.name || fingerprint,
    target: item.target || existing?.target || Array.from(locs)[0],
    locations: Array.from(locs),
    issuer: item.issuer || existing?.issuer || 'Internal CA',
    not_after: notAfter,
    checked_at: new Date(nowMs).toISOString(),
    last_checked: new Date(nowMs).toISOString(),
    last_error: item.last_error !== undefined ? item.last_error : (existing?.last_error || null),
    source: item.source || existing?.source || 'agent_probe',
    product: item.product || existing?.product || 'general',
    seats_total: item.seats_total !== undefined ? item.seats_total : (existing?.seats_total ?? null),
    seats_used: item.seats_used !== undefined ? item.seats_used : (existing?.seats_used ?? null),
    warning_days: Number(item.warning_days || item.warningThreshold || existing?.warning_days) || 30,
    critical_days: Number(item.critical_days || item.criticalThreshold || existing?.critical_days) || 14,
    auto_renew: item.auto_renew || item.autoRenew || existing?.auto_renew || 'Manual',
    days_remaining: daysLeft,
    daysLeft,
    status: resolveStatus(daysLeft, item.warning_days || 30, item.critical_days || 14),
    flags: Array.from(flagsSet)
  };

  inMemoryExpiryItems.set(fingerprint, record);

  // ClickHouse persistence if available
  if (clickhouse && typeof clickhouse.isConfigured === 'function' && clickhouse.isConfigured()) {
    try {
      await clickhouse.insertRows('expiry_items', [{
        fingerprint: record.fingerprint,
        kind: record.kind,
        subject: record.subject,
        locations: record.locations,
        not_after: record.not_after ? record.not_after.replace('T', ' ').replace('Z', '') : '1970-01-01 00:00:00',
        source: record.source,
        product: record.product,
        seats_total: record.seats_total,
        seats_used: record.seats_used,
        checked_at: record.checked_at.replace('T', ' ').replace('Z', ''),
        days_remaining: record.days_remaining !== null ? record.days_remaining : -1,
        status: record.status,
        flags: record.flags
      }]);
    } catch (_) {}
  }

  // Postgres fallback persistence
  try {
    const pool = await postgres.getPool();
    if (pool) {
      await pool.query(`
        INSERT INTO expiry_item (
          item_id, entity_id, kind, name, target, issuer, not_after, last_checked, last_error, warning_days, critical_days, auto_renew
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (item_id) DO UPDATE SET
          name = EXCLUDED.name,
          issuer = EXCLUDED.issuer,
          not_after = EXCLUDED.not_after,
          last_checked = EXCLUDED.last_checked,
          last_error = EXCLUDED.last_error,
          warning_days = EXCLUDED.warning_days,
          critical_days = EXCLUDED.critical_days,
          auto_renew = EXCLUDED.auto_renew;
      `, [
        record.item_id,
        record.entity_id,
        record.kind,
        record.name,
        record.target,
        record.issuer,
        record.not_after ? new Date(record.not_after) : null,
        new Date(record.last_checked),
        record.last_error,
        record.warning_days,
        record.critical_days,
        record.auto_renew
      ]);
    }
  } catch (_) {}

  return record;
}

/**
 * Retrieves all expiry items with calculated daysLeft and statuses.
 */
async function getExpiryItems(nowMs = Date.now()) {
  let items = [];

  try {
    const pool = await postgres.getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM expiry_item ORDER BY not_after ASC NULLS LAST');
      if (res.rows && res.rows.length > 0) {
        items = res.rows.map(r => ({
          ...r,
          fingerprint: r.item_id,
          not_after: r.not_after ? r.not_after.toISOString() : null,
          last_checked: r.last_checked ? r.last_checked.toISOString() : null
        }));
      }
    }
  } catch (_) {}

  if (items.length === 0) {
    items = Array.from(inMemoryExpiryItems.values());
  }

  return items.map(item => {
    const daysLeft = calculateDaysLeft(item.not_after, nowMs);
    const flags = item.flags || [];
    return {
      ...item,
      id: item.fingerprint || item.item_id,
      fingerprint: item.fingerprint || item.item_id,
      daysLeft,
      days_remaining: daysLeft,
      status: resolveStatus(daysLeft, item.warning_days || 30, item.critical_days || 14),
      warningThreshold: item.warning_days || 30,
      criticalThreshold: item.critical_days || 14,
      locations: item.locations || [item.target || 'localhost'],
      flags
    };
  });
}

// Clears the in-memory store.
function clearStore() {
  inMemoryExpiryItems.clear();
}

/**
 * Performs real TLS handshake probe against a host:port to extract peer certificate details.
 */
function probeTlsCertificate(target, port = 443, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const host = target.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    const socket = tls.connect(
      {
        host,
        port: parseInt(port, 10) || 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: timeoutMs
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const protocol = socket.getProtocol();
          const cipher = socket.getCipher();
          socket.destroy();
          if (cert && cert.valid_to) {
            const flags = [];
            if (protocol === 'TLSv1' || protocol === 'TLSv1.0') flags.push('TLS_1.0');
            if (cert.sigalg && cert.sigalg.toLowerCase().includes('sha1')) flags.push('SHA-1');

            resolve({
              success: true,
              target: `${host}:${port}`,
              fingerprint: cert.fingerprint256 || cert.fingerprint,
              issuer: cert.issuer?.O || cert.issuer?.CN || 'External CA',
              valid_to: new Date(cert.valid_to).toISOString(),
              subject: cert.subject?.CN || host,
              protocol,
              cipher: cipher?.name,
              flags
            });
          } else {
            resolve({ success: false, target: `${host}:${port}`, error: 'No peer certificate returned' });
          }
        } catch (e) {
          resolve({ success: false, target: `${host}:${port}`, error: e.message });
        }
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ success: false, target: `${host}:${port}`, error: err.message });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, target: `${host}:${port}`, error: 'TLS probe timed out' });
    });
  });
}

module.exports = {
  calculateDaysLeft,
  resolveStatus,
  upsertExpiryItem,
  getExpiryItems,
  probeTlsCertificate,
  computeFingerprint,
  clearStore
};
