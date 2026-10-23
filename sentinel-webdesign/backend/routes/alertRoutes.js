/**
 * backend/routes/alertRoutes.js
 *
 * M5 Task 5.3: Alert Lifecycle Management Routes
 * Endpoints for open, ack, snooze, and resolve (Role SRE Lead+, audited).
 */

const express = require('express');
const router = express.Router();
const alertEngine = require('@sentinel/analysis').alertEngine || require('../../ai_analysis/alert_engine');
const db = require('@sentinel/database');
const { requireRole, SRE_LEAD_PLUS } = require('../auth/require_role');
const { auditLog } = require('../audit_logger');
const { requestEnvironment } = require('./_prototype');

// [Phase S5] The shared role guard: works with cookie sessions (CSRF checked by
// requireAuth) and Bearer tokens alike.
const requireSreLead = requireRole(SRE_LEAD_PLUS);

/**
 * GET /api/v2/alerts?environment=
 */
router.get('/', (req, res) => {
  const env = requestEnvironment(req);
  const alerts = db.getAlerts(env) || [];
  res.json({
    environment: env,
    count: alerts.length,
    alerts
  });
});

/**
 * POST /api/v2/alerts/:id/ack
 */
router.post('/:id/ack', requireSreLead, (req, res) => {
  const { id } = req.params;
  const env = requestEnvironment(req);
  const username = req.user.username || req.user.name;

  const updated = alertEngine.acknowledgeAlert(id, username, env);
  if (!updated) {
    return res.status(404).json({ error: `Alert ${id} not found.` });
  }

  auditLog(req, 'ALERT_ACKNOWLEDGED', { alertId: id, user: username, environment: env });
  res.json({ success: true, alert: updated });
});

/**
 * POST /api/v2/alerts/:id/snooze
 */
router.post('/:id/snooze', requireSreLead, (req, res) => {
  const { id } = req.params;
  const env = requestEnvironment(req);
  const minutes = Math.min(Math.max(parseInt((req.body && req.body.minutes) || '60', 10) || 60, 1), 7 * 24 * 60);
  const username = req.user.username || req.user.name;

  const updated = alertEngine.snoozeAlert(id, minutes, username, env);
  if (!updated) {
    return res.status(404).json({ error: `Alert ${id} not found.` });
  }

  auditLog(req, 'ALERT_SNOOZED', { alertId: id, minutes, user: username, environment: env });
  res.json({ success: true, alert: updated });
});

/**
 * POST /api/v2/alerts/:id/resolve
 */
router.post('/:id/resolve', requireSreLead, (req, res) => {
  const { id } = req.params;
  const env = requestEnvironment(req);
  const username = req.user.username || req.user.name;

  const updated = alertEngine.resolveAlert(id, username, env);
  if (!updated) {
    return res.status(404).json({ error: `Alert ${id} not found.` });
  }

  auditLog(req, 'ALERT_RESOLVED', { alertId: id, user: username, environment: env });
  res.json({ success: true, alert: updated });
});

module.exports = router;
