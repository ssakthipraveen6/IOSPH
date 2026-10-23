/**
 * backend/jobs/alert_rules.js — P5
 *
 * Every 60 s (leader only): evaluates config/alerts/*.yaml for each environment and
 * creates or updates alerts through db.addAlert. A rule that stops firing resolves
 * the alert it opened. Firing inside an approved change window is recorded as
 * suppressed instead of opening an alert.
 *
 * Rule inputs:
 *  - threshold / composite: average of each metric over `for_seconds` (default 60 s)
 *  - baseline: latest point scored against the hour-of-week baseline (P3)
 *  - absence: last time the metric was seen per component in the last 24 h
 *    (`agent.heartbeat` is owned by the fleet-health job P10)
 *  - journey_failure: consecutive failed runs per journey from the journey runner
 */

const alertEngine = require('../../ai_analysis/alert_engine');
const baselines = require('../../ai_analysis/baselines');
const db = require('../../database/db');

// Synthetic check runner, or null when synthetics are not loaded.
function getRunner() {
  try {
    return require('@sentinel/synthetics').getGlobalRunner();
  } catch (_) {
    return null;
  }
}

// Alert message text for a rule.
function ruleMessage(rule, ctx = null) {
  // Stable text, so db.addAlert deduplicates repeated firings into one alert.
  if (rule.type === 'expiry' && ctx && ctx.item) {
    const fp = ctx.item.fingerprint || ctx.item.item_id || ctx.item.subject;
    return `[${rule.id}:${fp}] ${rule.name || rule.id}`;
  }
  return `[${rule.id}] ${rule.name || rule.id}`;
}

// Active alerts raised by this rule.
function activeRuleAlerts(store, env, rule) {
  return (store.getAlerts(env) || []).filter(a =>
    a.status === 'Active' &&
    typeof a.message === 'string' &&
    (a.message.startsWith(`[${rule.id}]`) || a.message.startsWith(`[${rule.id}:`))
  );
}

// Marks an alert resolved.
function resolveAlert(store, alert, nowMs) {
  alert.status = 'Resolved';
  alert.resolvedAt = new Date(nowMs).toISOString();
  alert.resolved_by = 'alert-engine';
  if (typeof store.persistAlert === 'function') store.persistAlert(alert);
}

/** Groups metric points by component: { component: { values: [..], lastTsMs, last } } */
async function metricWindow(store, env, metricName, sinceMs, nowMs) {
  const rows = await store.queryMetrics({ metricName, env, sinceMs, untilMs: nowMs, limit: 20000 });
  const byComponent = new Map();
  for (const r of rows || []) {
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
    const comp = r.component;
    if (!byComponent.has(comp)) byComponent.set(comp, { values: [], lastTsMs: 0, last: null, entityId: r.entity_id || `app:${comp}` });
    const g = byComponent.get(comp);
    g.values.push(r.value);
    const ts = new Date(r.timestamp).getTime();
    if (ts >= g.lastTsMs) { g.lastTsMs = ts; g.last = r.value; }
  }
  return byComponent;
}

// Average of an array.
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

// VIP probes (P1) store vip.* under `<product>_vip`; the agent stores agent.* under `<product>`.
// Composite rules compare the two, so they join on the product.
const productKey = (component) => String(component).replace(/_vip$/, '');

// Evaluates one rule and returns the contexts (component, value) that breach it.
async function contextsForRule(rule, env, { store, runner, nowMs, expiryStore } = {}) {
  const windowMs = (Number(rule.for_seconds) || 60) * 1000;
  const contexts = [];

  switch (rule.type) {
    case 'threshold': {
      const data = await metricWindow(store, env, rule.metric, nowMs - windowMs, nowMs);
      for (const [component, g] of data) {
        if (rule.component && rule.component !== component) continue;
        contexts.push({ env, component, values: { [rule.metric]: avg(g.values) } });
      }
      break;
    }
    case 'composite': {
      const perComponent = new Map();
      for (const cond of rule.conditions || []) {
        const data = await metricWindow(store, env, cond.metric, nowMs - windowMs, nowMs);
        const byProduct = new Map();
        for (const [component, g] of data) {
          const key = productKey(component);
          if (!byProduct.has(key)) byProduct.set(key, []);
          byProduct.get(key).push(...g.values);
        }
        for (const [component, values] of byProduct) {
          if (rule.component && rule.component !== component) continue;
          if (!perComponent.has(component)) perComponent.set(component, {});
          perComponent.get(component)[cond.metric] = avg(values);
        }
      }
      for (const [component, values] of perComponent) contexts.push({ env, component, values });
      break;
    }
    case 'baseline': {
      const data = await metricWindow(store, env, rule.metric, nowMs - windowMs, nowMs);
      for (const [component, g] of data) {
        if (rule.component && rule.component !== component) continue;
        const score = baselines.scoreObservation({
          env,
          entityId: g.entityId,
          metricName: rule.metric,
          value: g.last,
          timestamp: new Date(g.lastTsMs),
          zThreshold: Number(rule.z_threshold) || 3.0,
          consecutiveN: Number(rule.consecutive_points) || 3
        });
        contexts.push({ env, component, baselineScore: score });
      }
      break;
    }
    case 'absence': {
      if (rule.metric === 'agent.heartbeat') break; // P10 fleet-health owns silent agents
      const data = await metricWindow(store, env, rule.metric, nowMs - 24 * 3600 * 1000, nowMs);
      for (const [component, g] of data) {
        if (rule.component && rule.component !== component) continue;
        contexts.push({ env, component, lastSeenMs: g.lastTsMs, nowMs });
      }
      break;
    }
    case 'journey_failure': {
      if (!runner || !runner.history) break;
      for (const appId of runner.history.keys()) {
        if (rule.component && rule.component !== appId) continue;
        const runs = runner.getJourneyRuns(appId, { limit: 50, env });
        const byJourney = new Map();
        for (const run of runs) {
          if (!byJourney.has(run.journeyId)) byJourney.set(run.journeyId, []);
          byJourney.get(run.journeyId).push(run); // newest first
        }
        let worst = 0;
        for (const list of byJourney.values()) {
          let n = 0;
          for (const run of list) { if (run.success) break; n++; }
          worst = Math.max(worst, n);
        }
        if (byJourney.size > 0) contexts.push({ env, component: appId, consecutiveFailures: worst });
      }
      break;
    }
    case 'expiry': {
      let items = [];
      const expStore = expiryStore || require('../../database/expiry_store');
      try {
        items = await expStore.getExpiryItems(nowMs);
      } catch (_) {
        items = [];
      }
      for (const item of items) {
        if (rule.item_kind && item.kind !== rule.item_kind) continue;
        const comp = item.product || 'general';
        if (rule.component && rule.component !== comp) continue;
        contexts.push({ env, component: comp, item, nowMs });
      }
      break;
    }
    case 'trend': {
      const trendWindowMs = (Number(rule.for_seconds) || 86400) * 1000;
      const rows = await store.queryMetrics({ metricName: rule.metric, env, sinceMs: nowMs - trendWindowMs, untilMs: nowMs, limit: 20000 });
      const byComponent = new Map();
      for (const r of rows || []) {
        if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
        const comp = r.component;
        if (rule.component && rule.component !== comp) continue;
        if (!byComponent.has(comp)) byComponent.set(comp, []);
        byComponent.get(comp).push({ ts: new Date(r.timestamp).getTime(), value: r.value });
      }
      for (const [component, points] of byComponent) {
        contexts.push({ env, component, points });
      }
      break;
    }
    case 'runway': {
      const runwayWindowMs = (Number(rule.for_seconds) || 30 * 86400) * 1000;
      const rows = await store.queryMetrics({ metricName: rule.metric, env, sinceMs: nowMs - runwayWindowMs, untilMs: nowMs, limit: 20000 });
      const byComponent = new Map();
      for (const r of rows || []) {
        if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
        const comp = r.component;
        if (rule.component && rule.component !== comp) continue;
        if (!byComponent.has(comp)) byComponent.set(comp, []);
        byComponent.get(comp).push({ ts: new Date(r.timestamp).getTime(), value: r.value });
      }
      for (const [component, points] of byComponent) {
        contexts.push({ env, component, points });
      }
      break;
    }
    case 'slo_burn_rate': {
      const windowMs = (Number(rule.window_hours) || 1) * 3600 * 1000;
      const metricName = rule.metric || 'journey.success';
      const rows = await store.queryMetrics({ metricName, env, sinceMs: nowMs - windowMs, untilMs: nowMs, limit: 20000 });
      const byComponent = new Map();
      for (const r of rows || []) {
        if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
        const comp = r.component;
        if (rule.component && rule.component !== comp) continue;
        if (!byComponent.has(comp)) byComponent.set(comp, []);
        byComponent.get(comp).push(r.value);
      }
      for (const [component, vals] of byComponent) {
        const avgSuccess = avg(vals);
        const errorRate = Math.max(0, 100 - avgSuccess);
        contexts.push({ env, component, error_rate: errorRate, values: { error_rate: errorRate } });
      }
      break;
    }
    default:
      break;
  }
  return contexts;
}

// Runs every alert rule for each environment: opens new alerts and resolves cleared ones.
async function runAlertRules({
  environments = ['prod', 'staging'],
  rules = null,
  store = db,
  engine = alertEngine,
  runner = getRunner(),
  nowMs = Date.now(),
  expiryStore = null
} = {}) {
  const ruleList = rules || engine.loadRules();
  const summary = { rules: ruleList.length, opened_or_updated: 0, suppressed: 0, resolved: 0 };

  for (const env of environments) {
    for (const rule of ruleList) {
      const contexts = await contextsForRule(rule, env, { store, runner, nowMs, expiryStore });
      const firing = new Set();

      for (const ctx of contexts) {
        const result = await engine.evaluateRule({ ...rule, component: rule.component || ctx.component }, ctx);
        if (!result) continue;
        const alertKey = rule.type === 'expiry' && ctx.item ? (ctx.item.fingerprint || ctx.item.item_id) : ctx.component;
        firing.add(alertKey);
        if (result.is_suppressed) {
          summary.suppressed++;
          continue;
        }

        const transitionKey = `${env}:${rule.id}:${alertKey}`;
        let sev = result.severity;
        let rReason = result.reason;
        if (typeof engine.recordAlertTransition === 'function') {
          const flap = engine.recordAlertTransition(transitionKey, 'Active', nowMs);
          if (flap.isFlapping) {
            sev = 'critical';
            rReason = `[FLAPPING] Alert oscillated ${flap.changes} times in 30m. ${rReason}`;
          }
        }

        const msg = ruleMessage(rule, ctx);
        const alert = store.addAlert(ctx.component, sev, msg, 'Active', env);
        if (alert) {
          alert.rule_id = rule.id;
          alert.reason = rReason;
          if (result.runbook_url) alert.runbook_url = result.runbook_url;
          alert.evidence_pack_url = result.evidence_pack_url || `/api/v2/evidence/pack?alert=${encodeURIComponent(alert.id || rule.id)}`;
          if (rule.type === 'expiry' && ctx.item) {
            alert.fingerprint = alertKey;
          }
          if (typeof store.persistAlert === 'function') store.persistAlert(alert);
          summary.opened_or_updated++;
        }
      }

      for (const alert of activeRuleAlerts(store, env, rule)) {
        let isStillFiring = false;
        if (rule.type === 'expiry') {
          for (const key of firing) {
            if (alert.message.includes(`:${key}]`) || alert.fingerprint === key) {
              isStillFiring = true;
              break;
            }
          }
        } else {
          isStillFiring = firing.has(alert.component);
        }
        if (!isStillFiring) {
          const transitionKey = `${env}:${rule.id}:${alert.fingerprint || alert.component}`;
          if (typeof engine.recordAlertTransition === 'function') {
            engine.recordAlertTransition(transitionKey, 'Resolved', nowMs);
          }
          resolveAlert(store, alert, nowMs);
          summary.resolved++;
        }
      }
    }
  }
  return summary;
}

module.exports = { runAlertRules, contextsForRule, ruleMessage };
