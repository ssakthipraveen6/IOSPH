const fs = require('fs');
const path = require('path');

// Append-only audit log for all mutating API operations
// [DS-02] Satisfies SOX/PCI-DSS requirements for change audit trail with user attribution
const AUDIT_LOG_PATH = path.resolve(__dirname, '../../apps/api/logs', 'sentinel_audit.log');

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
 * Writes an immutable audit log entry for a mutating operation.
 * @param {object} req    Express request object (provides user identity and IP)
 * @param {string} action Short action label (e.g. 'ROTA_UPLOAD', 'SETTINGS_UPDATE')
 * @param {object} detail Key details about the action (sanitized — no raw passwords or secrets)
 */
function auditLog(req, action, detail = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    user: req.user ? req.user.username : 'UNAUTHENTICATED',
    role: req.user ? req.user.role : 'NONE',
    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    path: req.path,
    method: req.method,
    detail
  };

  const line = JSON.stringify(entry) + '\n';

  // Append to the audit log file asynchronously
  fs.appendFile(AUDIT_LOG_PATH, line, (err) => {
    if (err) {
      console.error('[AUDIT] Failed to write audit log entry:', err.message);
    }
  });

  // Also log to stdout for SIEM / log aggregation pipelines (ELK/Splunk/Dynatrace)
  console.info(`[AUDIT] ${entry.timestamp} | ${action} | user=${entry.user} | role=${entry.role} | ip=${entry.ip}`);
}

/**
 * Returns the last N audit log entries. Used by the admin dashboard.
 * @param {number} limit  Maximum number of entries to return
 * @returns {object[]}
 */
function getAuditLog(limit = 200) {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
    const lines = fs.readFileSync(AUDIT_LOG_PATH, 'utf8')
      .split('\n')
      .filter(l => l.trim().length > 0);
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch (e) { return { raw: l }; }
    }).reverse();
  } catch (e) {
    console.error('[AUDIT] Failed to read audit log:', e.message);
    return [];
  }
}

module.exports = { auditLog, getAuditLog };
