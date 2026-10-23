/**
 * Governance routes: pending four-eyes approvals and the audit trail.
 */
const express = require('express');
const router = express.Router();
const db = require('../../database/db');
const { getAuditLog, getAuditLogFromDb } = require('../audit_logger');

const { requestEnvironment } = require('./_prototype');

const GOVERNANCE_AUDIT_ACTIONS = new Set([
  'RECOVERY_TRIGGERED', 'RECOVERY_APPROVED', 'CIRCUIT_BREAKER_RESET', 'SETTINGS_UPDATE',
  'SIMULATION_TRIGGER', 'METRICS_CLEARED', 'ENVIRONMENT_SWITCH', 'INGEST_KEY_CREATED', 'INGEST_KEY_REVOKED'
]);

// Shapes a remediation run as a pending approval.
function toPendingAction(run) {
  const approvals = Array.isArray(run.approvals)
    ? run.approvals.map(a => (typeof a === 'string' ? { username: a, role: null, timestamp: null } : a))
    : [];
  const first = approvals[0] || null;
  return {
    id: run.id,
    action: run.action || null,
    target: run.component || null,
    incidentId: run.incident_id || null,
    initiatedBy: run.initiated_by || null,
    primarySigner: first ? first.username : null,
    primarySignedAt: first ? first.timestamp : null,
    approvals,
    approvalsRequired: 2,
    status: approvals.length === 0 ? 'PENDING_FIRST_SIGN' : 'PENDING_CO_SIGN',
    requestedAt: run.timestamp || null
  };
}

// Shapes one audit entry.
function toAuditEntry(e) {
  return {
    timestamp: e.timestamp || null,
    event: e.action || null,
    details: e.detail ? JSON.stringify(e.detail) : '',
    operator: e.user || null,
    ip: e.ip || null
  };
}

// Reads the audit trail from PostgreSQL or the log file.
async function readAuditTrail(limit) {
  // Postgres audit_event is the queryable trail; the local file WAL is the fallback.
  try {
    const fromDb = await getAuditLogFromDb(limit * 4);
    if (Array.isArray(fromDb)) return fromDb;
  } catch (_) { /* unreachable database: fall back to the file WAL */ }
  return getAuditLog(limit * 4);
}

// [M1.2] Prod and staging serve real Awaiting-Approval runs and the real audit trail.
router.get('/sod-audit', async (req, res) => {
  const env = requestEnvironment(req);
  try {
    const pendingActions = (db.getRecoveryLogs(env) || [])
      .filter(r => r.status === 'Awaiting-Approval')
      .map(toPendingAction);
    const auditTrail = (await readAuditTrail(25))
      .filter(e => e && GOVERNANCE_AUDIT_ACTIONS.has(e.action))
      .slice(0, 25)
      .map(toAuditEntry);
    return res.json({
      status: 'OK',
      environment: env,
      prototype: false,
      pendingActions,
      itsmSync: [],
      auditTrail,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: `Governance lookup failed: ${err.message}` });
  }
});

module.exports = router;
