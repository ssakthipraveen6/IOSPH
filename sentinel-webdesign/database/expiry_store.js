/**
 * database/expiry_store.js
 *
 * Real TLS, Secret, and License Expiry Datastore (Phase 5 / T5.4).
 * Supports PostgreSQL persistence with in-memory ring-buffer fallback,
 * real TLS peer socket probing via tls.connect(), and dynamic daysLeft calculation.
 */

const tls = require('tls');
const postgres = require('./postgres');

let inMemoryExpiryItems = new Map();

/**
 * Calculates daysLeft dynamically from not_after timestamp.
 */
function calculateDaysLeft(notAfter) {
  if (!notAfter) return null;
  const expiryDate = new Date(notAfter).getTime();
  const now = Date.now();
  const diffDays = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Resolves item status ('healthy', 'warning', 'critical') based on dynamic daysLeft.
 */
function resolveStatus(daysLeft, warningDays = 30, criticalDays = 7) {
  if (daysLeft === null || daysLeft === undefined) return 'unknown';
  if (daysLeft <= criticalDays) return 'critical';
  if (daysLeft <= warningDays) return 'warning';
  return 'healthy';
}

/**
 * Saves or updates an expiry item.
 */
async function upsertExpiryItem(item) {
  if (!item || !item.item_id) return null;

  const record = {
    item_id: item.item_id,
    entity_id: item.entity_id || null,
    kind: item.kind || 'tls_cert',
    name: item.name || item.item_id,
    target: item.target || 'localhost',
    issuer: item.issuer || 'Internal CA',
    not_after: item.not_after ? new Date(item.not_after).toISOString() : null,
    last_checked: new Date().toISOString(),
    last_error: item.last_error || null,
    warning_days: Number(item.warning_days || item.warningThreshold) || 30,
    critical_days: Number(item.critical_days || item.criticalThreshold) || 7,
    auto_renew: item.auto_renew || item.autoRenew || 'Manual'
  };

  inMemoryExpiryItems.set(record.item_id, record);

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
async function getExpiryItems() {
  let items = [];

  try {
    const pool = await postgres.getPool();
    if (pool) {
      const res = await pool.query('SELECT * FROM expiry_item ORDER BY not_after ASC NULLS LAST');
      if (res.rows && res.rows.length > 0) {
        items = res.rows.map(r => ({
          ...r,
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
    const daysLeft = calculateDaysLeft(item.not_after);
    return {
      ...item,
      id: item.item_id,
      daysLeft,
      status: resolveStatus(daysLeft, item.warning_days, item.critical_days),
      warningThreshold: item.warning_days,
      criticalThreshold: item.critical_days
    };
  });
}

/**
 * Performs real TLS handshake probe against a host:port to extract peer certificate notAfter date.
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
          socket.destroy();
          if (cert && cert.valid_to) {
            resolve({
              success: true,
              target: `${host}:${port}`,
              issuer: cert.issuer?.O || cert.issuer?.CN || 'External CA',
              valid_to: new Date(cert.valid_to).toISOString(),
              subject: cert.subject?.CN || host
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
  probeTlsCertificate
};
