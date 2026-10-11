const fs = require('fs');
const path = require('path');
const postgres = require('../database/postgres');

// Append-only audit log for all mutating API operations
// [DS-02] Satisfies SOX/PCI-DSS requirements for change audit trail with user attribution (T0.16)
const AUDIT_LOG_PATH = path.join(__dirname, '../logs', 'sentinel_audit.log');

// Ensure log directory exists
try {
  const logDir = path.dirname(AUDIT_LOG_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (e) {
  console.error('[AUDIT] Could not create audit log directory:', e.message);
}

/**
 * Writes a durable audit log entry for a mutating operation.
 * Synchronously appends to disk to ensure durability and emits to stdout for enterprise SIEM.
 * @param {object} req    Express request object (provides user identity and IP)
 * @param {string} action Short action label (e.g. 'ROTA_UPLOAD', 'SETTINGS_UPDATE')
 * @param {object} detail Key details about the action (sanitized — no raw passwords or secrets)
 */
function auditLog(req, action, detail = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    trace_id: req.traceId || (req.headers ? req.headers['x-trace-id'] : null) || null,
    action,
    user: req.user ? req.user.username : 'UNAUTHENTICATED',
    role: req.user ? req.user.role : 'NONE',
    ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
    userAgent: req.headers ? req.headers['user-agent'] : 'system',
    path: req.path || 'internal',
    method: req.method || 'INTERNAL',
    detail
  };

  const line = JSON.stringify(entry) + '\n';

  // [T0.16] Durable append write
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, line, 'utf8');
  } catch (err) {
    console.error('[AUDIT] [FATAL] Failed to persist audit log entry to disk:', err.message);
  }

  // [T0.16] Forward to stdout as system of record for enterprise SIEM ingestion
  console.info(`[AUDIT] ${entry.timestamp} | ${action} | user=${entry.user} | role=${entry.role} | ip=${entry.ip}`);

  // [T0.16] Mirror into the append-only audit_event table. The file write above is the
  // durable local WAL; this makes the trail queryable. Never throws into the request path.
  postgres.query(
    `INSERT INTO audit_event (ts, actor, actor_role, action, target, detail, ip, user_agent, http_path, http_method, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [entry.timestamp, entry.user, entry.role, entry.action, detail && detail.target ? String(detail.target) : null,
     JSON.stringify(detail || {}), entry.ip, entry.userAgent, entry.path, entry.method, entry.trace_id]
  ).catch(err => {
    console.warn('[AUDIT] audit_event insert failed (file WAL retains the entry):', err.message);
  });
}

/**
 * Returns the last N audit log entries.
 * [T0.16] Uses bounded tail reading to prevent OOM / DoS from reading huge files.
 * @param {number} limit  Maximum number of entries to return
 * @returns {object[]}
 */
async function getAuditLogFromDb(limit = 200) {
  const res = await postgres.query(
    `SELECT ts, actor, actor_role, action, detail, ip, user_agent, http_path, http_method
       FROM audit_event ORDER BY ts DESC LIMIT $1`, [limit]);
  if (!res) return null;
  return res.rows.map(r => ({
    timestamp: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
    action: r.action,
    user: r.actor,
    role: r.actor_role,
    ip: r.ip,
    userAgent: r.user_agent,
    path: r.http_path,
    method: r.http_method,
    detail: r.detail || {}
  }));
}

function getAuditLog(limit = 200) {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];

    const stats = fs.statSync(AUDIT_LOG_PATH);
    if (stats.size === 0) return [];

    // Bounded buffer: read at most 128KB from the tail of the log file
    const maxReadBytes = Math.min(stats.size, Math.max(64 * 1024, limit * 512));
    const buffer = Buffer.alloc(maxReadBytes);
    const fd = fs.openSync(AUDIT_LOG_PATH, 'r');

    try {
      fs.readSync(fd, buffer, 0, maxReadBytes, stats.size - maxReadBytes);
    } finally {
      fs.closeSync(fd);
    }

    const chunk = buffer.toString('utf8');
    const lines = chunk.split('\n').filter(l => l.trim().length > 0);

    return lines.slice(-limit).map(l => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return { raw: l };
      }
    }).reverse();
  } catch (e) {
    console.error('[AUDIT] Failed to read audit log:', e.message);
    return [];
  }
}

module.exports = { auditLog, getAuditLog, getAuditLogFromDb };
