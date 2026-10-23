/**
 * backend/jobs/problem_grouping.js — P6 + P7
 *
 * Every 60 s (leader only), per environment:
 *  1. Active alerts without a problem_id join an OPEN problem that already holds an
 *     alert for the same component; the rest are grouped by topology into new
 *     problems (correlation.groupAlertsIntoProblems) with stored evidence:
 *     recent journey runs, vip.* metrics and version/file change events.
 *  2. Problems are written to Postgres (`problem`, migration 015) so both nodes see
 *     them, and each alert gets its problem_id.
 *  3. A problem whose alerts are all no longer Active is marked RESOLVED.
 *  4. P7: one Teams message per new problem and one per resolved problem
 *     (blank webhook URL = off).
 */

const correlation = require('@sentinel/correlation');
const problemStore = require('../../correlation/problem_store');
const eventStore = require('../../database/event_store');
const db = require('../../database/db');
const teams = require('../services/notify/teams');

// Synthetic check runner, or null.
function getRunner() {
  try {
    return require('@sentinel/synthetics').getGlobalRunner();
  } catch (_) {
    return null;
  }
}

/** Recent journey runs in the shape diagnoseLayer() reads. */
function journeyEvidence(runner, env, sinceMs) {
  if (!runner || !runner.history) return [];
  const out = [];
  for (const appId of runner.history.keys()) {
    for (const run of runner.getJourneyRuns(appId, { limit: 20, env })) {
      if (new Date(run.startedAt).getTime() < sinceMs) continue;
      out.push({
        id: run.journeyId,
        productId: appId,
        steps: (run.steps || []).map(st => ({
          id: st.id,
          layer: st.layer || 'app',
          status: st.success ? 'OK' : (st.status || 'FAILED'),
          duration_ms: st.durationMs
        }))
      });
    }
  }
  return out;
}

// VIP and agent latency evidence for a problem.
async function metricEvidence(store, env, sinceMs, nowMs) {
  const names = ['vip.dns_ms', 'vip.tcp_ms', 'vip.tls_ms', 'vip.total_ms', 'agent.localhost_ms'];
  const out = [];
  for (const metricName of names) {
    try {
      const rows = await store.queryMetrics({ metricName, env, sinceMs, untilMs: nowMs, limit: 5000 });
      for (const r of rows || []) if (typeof r.value === 'number') out.push(r);
    } catch (_) { /* store unavailable: no metric evidence */ }
  }
  return out;
}

// Changes made shortly before a problem.
async function changeEvidence(events, env, sinceMs, nowMs) {
  try {
    const rows = await events.getEvents({ from: new Date(sinceMs).toISOString(), to: new Date(nowMs).toISOString(), environment: env, limit: 500 });
    return (rows || []).filter(e => e.kind === 'version_change' || e.kind === 'file_change');
  } catch (_) {
    return [];
  }
}

// Groups related alerts into problems, attaches evidence and notifies Teams.
async function runProblemGrouping({
  environments = ['prod', 'staging'],
  store = db,
  problems = problemStore,
  events = eventStore,
  grouping = correlation,
  notifier = teams,
  runner = getRunner(),
  nowMs = Date.now(),
  evidenceWindowMinutes = 30
} = {}) {
  const summary = {};
  const sinceMs = nowMs - evidenceWindowMinutes * 60 * 1000;

  for (const env of environments) {
    const s = { new_problems: 0, joined_existing: 0, resolved: 0, notified: 0 };
    const allAlerts = store.getAlerts(env) || [];
    const openProblems = await problems.list(env, { status: 'OPEN' });

    // 1a. Attach to an open problem holding an alert of the same component.
    const componentToProblem = new Map();
    for (const p of openProblems) {
      for (const a of (p.evidence_pack && p.evidence_pack.alerts) || []) {
        if (a.component) componentToProblem.set(a.component, p);
      }
    }
    const ungrouped = [];
    for (const alert of allAlerts) {
      if (alert.status !== 'Active' || alert.problem_id) continue;
      const existing = componentToProblem.get(alert.component);
      if (existing) {
        alert.problem_id = existing.id;
        existing.alerts = [...new Set([...(existing.alerts || []), alert.id])];
        existing.alert_count = existing.alerts.length;
        existing.evidence_pack = { ...(existing.evidence_pack || {}), alerts: [...((existing.evidence_pack && existing.evidence_pack.alerts) || []), alert] };
        existing.updated_at = new Date(nowMs).toISOString();
        await problems.save(existing);
        if (typeof store.persistAlert === 'function') store.persistAlert(alert);
        s.joined_existing++;
      } else {
        ungrouped.push(alert);
      }
    }

    // 1b. New problems from the rest, with stored evidence.
    if (ungrouped.length > 0) {
      const [journeys, metrics, changeEvents] = await Promise.all([
        Promise.resolve(journeyEvidence(runner, env, sinceMs)),
        metricEvidence(store, env, sinceMs, nowMs),
        changeEvidence(events, env, sinceMs, nowMs)
      ]);
      const created = await grouping.groupAlertsIntoProblems(ungrouped, { environment: env, journeys, metrics, events: changeEvents });
      for (const problem of created) {
        problem.environment = env;
        await problems.save(problem);
        for (const alert of ungrouped.filter(a => a.problem_id === problem.id)) {
          if (typeof store.persistAlert === 'function') store.persistAlert(alert);
        }
        s.new_problems++;
        const sent = await notifier.sendProblemNotification(problem, null, { event: 'opened' });
        if (sent && sent.status === 'DELIVERED') s.notified++;
      }
    }

    // 3. Resolve problems whose alerts are no longer active.
    const byId = new Map(allAlerts.map(a => [a.id, a]));
    for (const p of await problems.list(env, { status: 'OPEN' })) {
      const ids = p.alerts || [];
      if (ids.length === 0) continue;
      const stillActive = ids.some(id => {
        const a = byId.get(id);
        return a ? a.status === 'Active' || a.status === 'Acknowledged' || a.status === 'Snoozed' : false;
      });
      const anyKnown = ids.some(id => byId.has(id));
      if (stillActive || !anyKnown) continue;
      p.status = 'RESOLVED';
      p.resolved_at = new Date(nowMs).toISOString();
      p.updated_at = p.resolved_at;
      await problems.save(p);
      s.resolved++;
      const sent = await notifier.sendProblemNotification(p, null, { event: 'resolved' });
      if (sent && sent.status === 'DELIVERED') s.notified++;
    }

    summary[env] = s;
  }
  return summary;
}

module.exports = { runProblemGrouping, journeyEvidence };
