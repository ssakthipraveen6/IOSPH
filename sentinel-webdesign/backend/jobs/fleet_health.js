/**
 * backend/jobs/fleet_health.js — P10
 *
 * Every 60 s (leader only), for every host that has ever sent an agent heartbeat:
 *  - silent agent: no heartbeat for more than `silent_after_seconds` (default 300)
 *    opens ONE alert per host (repeated firings update the same alert); it is
 *    resolved when heartbeats return;
 *  - config drift: the config_hash the agent reports differs from the hash that
 *    /api/v2/agent/config renders for that host today; resolved when they match.
 * The drift state is also written to the host's inventory labels for the fleet view.
 */

const { SEVERITY } = require('@sentinel/shared-constants');
const inventory = require('@sentinel/inventory');
const db = require('../../database/db');
const { renderAgentConfig } = require('../routes/agentRoutes');

const SILENT_RULE = 'fleet_silent_agent';
const DRIFT_RULE = 'fleet_config_drift';

// Host name of an inventory entity.
function hostName(entity) {
  return entity.name || String(entity.entity_id || '').replace(/^host:/, '');
}

// Active alerts of a rule for a component.
function findActive(store, env, component, ruleId) {
  return (store.getAlerts(env) || []).filter(a => a.status === 'Active' && a.component === component && a.rule_id === ruleId);
}

// Opens an alert.
function openAlert(store, env, component, severity, message, ruleId, reason) {
  const alert = store.addAlert(component, severity, message, 'Active', env);
  if (alert) {
    alert.rule_id = ruleId;
    alert.reason = reason;
    if (typeof store.persistAlert === 'function') store.persistAlert(alert);
  }
  return alert;
}

// Resolves a list of alerts.
function resolveAll(store, alerts, nowMs) {
  for (const a of alerts) {
    a.status = 'Resolved';
    a.resolvedAt = new Date(nowMs).toISOString();
    a.resolved_by = 'fleet-health';
    if (typeof store.persistAlert === 'function') store.persistAlert(a);
  }
  return alerts.length;
}

// Raises alerts for silent agents and agent version drift; resolves them when cleared.
async function runFleetHealth({
  environments = ['prod', 'staging'],
  store = db,
  inv = inventory,
  render = renderAgentConfig,
  nowMs = Date.now(),
  silentAfterSeconds = 300
} = {}) {
  const summary = {};
  for (const env of environments) {
    const s = { agents: 0, silent: 0, drifted: 0, resolved: 0 };
    const hosts = await inv.getEntities({ kind: 'host', environment: env, limit: 100000 });
    const list = Array.isArray(hosts) ? hosts : (hosts && hosts.entities) || [];

    for (const entity of list) {
      const labels = entity.labels || {};
      if (!labels.last_heartbeat) continue; // never had an agent: coverage, not silence
      s.agents++;
      const name = hostName(entity);

      // Silent agent
      const ageSec = (nowMs - new Date(labels.last_heartbeat).getTime()) / 1000;
      if (ageSec > silentAfterSeconds) {
        openAlert(store, env, name, SEVERITY.CRITICAL,
          `Agent silent: no heartbeat from ${name} for more than ${Math.round(silentAfterSeconds / 60)} min`,
          SILENT_RULE, `last heartbeat ${labels.last_heartbeat}`);
        s.silent++;
      } else {
        s.resolved += resolveAll(store, findActive(store, env, name, SILENT_RULE), nowMs);
      }

      // Config drift
      if (labels.config_hash) {
        const expected = render({ host: name, os: labels.os || '', agentVersion: labels.agent_version || null, env }).config_hash;
        const drifted = expected !== labels.config_hash;
        if (drifted) {
          openAlert(store, env, name, SEVERITY.WARNING,
            `Agent config drift on ${name}: reported config differs from the served config`,
            DRIFT_RULE, `reported ${labels.config_hash.slice(0, 12)}…, expected ${expected.slice(0, 12)}…`);
          s.drifted++;
        } else {
          s.resolved += resolveAll(store, findActive(store, env, name, DRIFT_RULE), nowMs);
        }
        if (Boolean(labels.config_drift) !== drifted) {
          await inv.upsertEntity({ ...entity, labels: { config_drift: drifted, expected_config_hash: expected } });
        }
      }
    }
    summary[env] = s;
  }
  return summary;
}

module.exports = { runFleetHealth, SILENT_RULE, DRIFT_RULE };
