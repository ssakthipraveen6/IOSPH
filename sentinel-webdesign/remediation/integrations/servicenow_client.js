const db = require('@sentinel/database');

/**
 * Enterprise ServiceNow REST API Client & On-Call Dispatcher
 * Bridges Sentinel Autonomous Recovery with enterprise ITSM change management.
 */

async function createIncidentForRecovery(recoveryRun, hypothesis = null) {
  if (!recoveryRun) return null;

  let onCallAssignee = 'sre-oncall-primary';
  try {
    const { teamRotaService } = require('@sentinel/ai_analysis');
    if (teamRotaService && teamRotaService.getCurrentOnCall) {
      const rota = teamRotaService.getCurrentOnCall('primary');
      if (rota && rota.name) onCallAssignee = rota.name;
    }
  } catch (_) {}

  // [M1.1] SENTINEL has no ServiceNow write integration and must not change the
  // existing change process, so it prepares a ticket draft (evidence for the owning
  // team) and never invents an incident number.
  const incidentId = null;
  const title = `[SENTINEL AUTO-REMEDIATION] ${recoveryRun.action} on ${recoveryRun.component}`;
  const description = `Recovery Run ID: ${recoveryRun.id}\nReason: ${recoveryRun.triggerReason}\nStatus: ${recoveryRun.status}\nAssigned On-Call: ${onCallAssignee}\n${hypothesis ? `Correlated Root Cause: ${hypothesis.suspect_entity_id} (Confidence: ${hypothesis.confidence})` : ''}`;

  // Log to database alert stream for NOC visibility
  try {
    db.addAlert('servicenow', 'Warning', `ServiceNow ticket draft prepared for ${recoveryRun.id} (not submitted): ${title}`, 'Active', recoveryRun.env);
  } catch (_) {}

  return {
    incident_id: incidentId,
    title,
    description,
    state: 'Draft',
    recovery_id: recoveryRun.id,
    assigned_to: onCallAssignee,
    urgency: recoveryRun.env === 'prod' ? '1 - High' : '2 - Medium',
    created_at: new Date().toISOString()
  };
}

// Resolves the incident of a recovery run.
async function resolveIncidentForRecovery(recoveryRun, duration) {
  if (!recoveryRun) return null;
  const incidentId = recoveryRun.incident_id || null;
  const msg = incidentId
    ? `Recovery ${recoveryRun.id} for ServiceNow ${incidentId} completed in ${duration}s.`
    : `Recovery ${recoveryRun.id} completed in ${duration}s (no ServiceNow ticket recorded).`;

  try {
    db.addAlert('servicenow', 'Info', msg, 'Resolved', recoveryRun.env);
  } catch (_) {}

  return {
    incident_id: incidentId,
    state: 'Resolved',
    resolution_notes: `Autonomous self-healing completed successfully in ${duration} seconds.`,
    resolved_at: new Date().toISOString()
  };
}

module.exports = {
  createIncidentForRecovery,
  resolveIncidentForRecovery
};
