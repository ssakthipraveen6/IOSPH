/**
 * ai_analysis/alert_engine.js
 *
 * M5 Task 5.3: Alert Engine & Lifecycle Management
 * Evaluates rules of type threshold, baseline, absence, composite, and journey_failure.
 * Manages full lifecycle: open -> ack -> snooze -> resolve.
 * Honors maintenance windows (change_window) to suppress notifications.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const { normalizeSeverity, SEVERITY } = require('@sentinel/shared-constants');

let db = null;
try {
  db = require('@sentinel/database');
} catch (_) {
  try {
    db = require('../database/db');
  } catch (e) {
    db = null;
  }
}

let changeRoutes = null;
try {
  changeRoutes = require('../backend/routes/changeRoutes');
} catch (_) {
  changeRoutes = null;
}

const ALERTS_CONFIG_DIR = path.resolve(__dirname, '..', 'config', 'alerts');

/**
 * Load all alert rules from config/alerts/*.yaml
 */
function loadRules() {
  const rules = [];
  if (!fs.existsSync(ALERTS_CONFIG_DIR)) return rules;

  const files = fs.readdirSync(ALERTS_CONFIG_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(ALERTS_CONFIG_DIR, f), 'utf8');
      const parsed = yaml.load(content);
      if (parsed && Array.isArray(parsed.alerts)) {
        for (const r of parsed.alerts) {
          if (r.id && r.type) {
            rules.push({
              ...r,
              severity: normalizeSeverity(r.severity || 'warning')
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[ALERT_ENGINE] Failed loading alert rules from ${f}:`, err.message);
    }
  }
  return rules;
}

/**
 * Checks if the target is covered by an active maintenance window
 */
async function isInMaintenanceWindow(env, productId, host) {
  if (changeRoutes && typeof changeRoutes.isWithinChangeWindow === 'function') {
    // isWithinChangeWindow takes one options object and resolves { approved, window }.
    const match = await changeRoutes.isWithinChangeWindow({ environment: env, productId, host });
    return !!(match && match.approved);
  }
  return false;
}

/**
 * Evaluates an individual alert rule against current metric/state context
 */
async function evaluateRule(rule, context = {}) {
  const env = context.env || 'staging';
  const values = context.values || {};
  let triggered = false;
  let reason = '';

  switch (rule.type) {
    case 'threshold': {
      let val = values[rule.metric];
      if (typeof val !== 'number') {
        const variants = [
          rule.metric.replace(/_/g, '.'),
          rule.metric.replace(/\./g, '_'),
          rule.metric.replace('backup_age', 'backup.age'),
          rule.metric.replace('backup.age', 'backup_age')
        ];
        for (const v of variants) {
          if (typeof values[v] === 'number') { val = values[v]; break; }
        }
        if (typeof val !== 'number') {
          if (rule.id === 'rule_unapproved_config_change' && typeof values['config.drift.unapproved_count'] === 'number') {
            val = values['config.drift.unapproved_count'];
          }
        }
      }
      if (typeof val === 'number') {
        if (rule.operator === '>' && val > rule.threshold) triggered = true;
        if (rule.operator === '>=' && val >= rule.threshold) triggered = true;
        if (rule.operator === '<' && val < rule.threshold) triggered = true;
        if (rule.operator === '<=' && val <= rule.threshold) triggered = true;
        if (rule.operator === '==' && val === rule.threshold) triggered = true;
        if (triggered) {
          reason = `${rule.metric} (${val}) ${rule.operator} ${rule.threshold}`;
        }
      }
      break;
    }

    case 'baseline': {
      const score = context.baselineScore;
      if (score && score.isAnomaly) {
        triggered = true;
        reason = `Robust Z-score ${score.robustZ} >= ${score.threshold}`;
      }
      break;
    }

    case 'absence': {
      const lastSeen = context.lastSeenMs || 0;
      const elapsedSeconds = (Date.now() - lastSeen) / 1000;
      if (elapsedSeconds > (rule.absence_seconds || 300)) {
        triggered = true;
        reason = `Metric ${rule.metric} absent for ${Math.round(elapsedSeconds)}s (limit ${rule.absence_seconds}s)`;
      }
      break;
    }

    case 'journey_failure': {
      const failCount = context.consecutiveFailures || 0;
      if (failCount >= (rule.consecutive_failures || 2)) {
        triggered = true;
        reason = `${failCount} consecutive golden journey runs failed`;
      }
      break;
    }

    case 'composite': {
      const conds = rule.conditions || [];
      const results = conds.map(c => {
        const val = values[c.metric];
        if (typeof val !== 'number') return false;
        if (c.operator === '>') return val > c.threshold;
        if (c.operator === '<') return val < c.threshold;
        if (c.operator === '>=') return val >= c.threshold;
        if (c.operator === '<=') return val <= c.threshold;
        return false;
      });

      if (rule.operator === 'AND') {
        triggered = results.length > 0 && results.every(Boolean);
      } else {
        triggered = results.some(Boolean);
      }
      if (triggered) {
        reason = `Composite rule [${rule.operator}] satisfied: ${JSON.stringify(values)}`;
      }
      break;
    }

    case 'expiry': {
      const item = context.item;
      if (!item) break;
      if (rule.item_kind && item.kind !== rule.item_kind) break;

      // License capacity saturation
      if (typeof rule.capacity_pct_threshold === 'number') {
        const total = Number(item.seats_total);
        const used = Number(item.seats_used);
        if (total > 0 && used >= 0) {
          const pct = (used / total) * 100;
          if (pct >= rule.capacity_pct_threshold) {
            triggered = true;
            reason = `License seat capacity at ${pct.toFixed(1)}% (used ${used}/${total}) exceeds threshold ${rule.capacity_pct_threshold}%`;
          }
        }
      }

      // Expiry days threshold
      if (!triggered && typeof rule.days_threshold === 'number') {
        const days = item.daysLeft !== undefined ? item.daysLeft : item.days_remaining;
        if (typeof days === 'number' && days <= rule.days_threshold) {
          triggered = true;
          const label = item.kind === 'license' ? 'License' : 'Certificate';
          reason = `${label} "${item.subject || item.name}" expires in ${days} days (threshold: ${rule.days_threshold}d)`;
        }
      }
      break;
    }

    case 'trend': {
      let forecastHelper;
      try { forecastHelper = require('../analytics/forecast'); } catch (_) { forecastHelper = null; }
      const trendResult = context.trendResult || (context.points && forecastHelper ? forecastHelper.linearTrend(context.points) : null);
      if (trendResult && trendResult.is_growth) {
        const r2Threshold = typeof rule.r2_threshold === 'number' ? rule.r2_threshold : 0.8;
        const growthThreshold = typeof rule.growth_pct_threshold === 'number' ? rule.growth_pct_threshold : 20;
        if (trendResult.r2 >= r2Threshold && trendResult.growth_pct >= growthThreshold) {
          triggered = true;
          reason = `Memory/resource growth trend: ${trendResult.growth_pct}% over window (threshold >= ${growthThreshold}%, R² = ${trendResult.r2} >= ${r2Threshold})`;
        }
      }
      break;
    }

    case 'runway': {
      let forecastHelper;
      try { forecastHelper = require('../analytics/forecast'); } catch (_) { forecastHelper = null; }
      const runwayResult = context.runwayResult || (context.points && forecastHelper ? forecastHelper.linearRunway(context.points, rule.limit || 100) : null);
      if (runwayResult) {
        const days7d = runwayResult.days_to_full_7d;
        const days30d = runwayResult.days_to_full_30d;
        const validDays = [days7d, days30d].filter(d => typeof d === 'number' && d >= 0);
        if (validDays.length > 0) {
          const minDays = Math.min(...validDays);
          const limitDays = typeof rule.limit_days === 'number' ? rule.limit_days : 7;
          if (minDays < limitDays) {
            triggered = true;
            reason = `Disk runway is ${minDays.toFixed(1)} days (threshold < ${limitDays}d; 7d proj: ${days7d !== null ? days7d + 'd' : 'n/a'}, 30d proj: ${days30d !== null ? days30d + 'd' : 'n/a'})`;
          }
        }
      }
      break;
    }

    case 'slo_burn_rate': {
      const sloTarget = typeof rule.slo_target === 'number' ? rule.slo_target : 99.0;
      const budget = (100 - sloTarget) / 100;
      const burnThreshold = typeof rule.burn_rate_threshold === 'number' ? rule.burn_rate_threshold : 14.4;
      const errorRate = typeof context.error_rate === 'number'
        ? context.error_rate
        : (typeof (context.values && context.values.error_rate) === 'number' ? context.values.error_rate : null);

      if (typeof errorRate === 'number') {
        const errorFraction = errorRate > 1 ? errorRate / 100 : errorRate;
        const currentBurnRate = budget > 0 ? (errorFraction / budget) : 0;
        if (currentBurnRate >= burnThreshold) {
          triggered = true;
          reason = `SLO burn rate ${currentBurnRate.toFixed(1)}x exceeds threshold ${burnThreshold}x (SLO target: ${sloTarget}%, error rate: ${(errorFraction * 100).toFixed(2)}%)`;
        }
      }
      break;
    }

    default:
      break;
  }

  if (!triggered) return null;

  const inMaint = await isInMaintenanceWindow(env, rule.component || context.component, context.host);

  return {
    rule_id: rule.id,
    name: rule.name,
    type: rule.type,
    severity: rule.severity,
    component: rule.component || context.component || 'general',
    environment: env,
    reason,
    is_suppressed: inMaint,
    runbook_url: rule.runbook_url || null,
    evidence_pack_url: `/api/v2/evidence/pack?alert=${encodeURIComponent(rule.id)}`,
    timestamp: new Date().toISOString()
  };
}

// Finds an alert by id.
function findAlert(alertId, env) {
  if (!db) return null;
  if (typeof db.getAlertById === 'function') {
    const found = db.getAlertById(alertId);
    if (found) return found;
  }
  if (env) {
    const list = db.getAlerts(env);
    const found = list && list.find(a => a.id === alertId);
    if (found) return found;
  }
  const prodList = (typeof db.getAlerts === 'function') ? db.getAlerts('prod') : [];
  const foundProd = prodList && prodList.find(a => a.id === alertId);
  if (foundProd) return foundProd;

  if (Array.isArray(db.alerts)) {
    return db.alerts.find(a => a.id === alertId) || null;
  }
  return null;
}

/**
 * Acknowledge an alert
 */
function acknowledgeAlert(alertId, username, env = 'staging') {
  const target = findAlert(alertId, env);
  if (!target) return null;

  target.status = 'Acknowledged';
  target.acked_by = username;
  target.acked_at = new Date().toISOString();
  if (db && typeof db.persistAlert === 'function') db.persistAlert(target);
  return target;
}

/**
 * Snooze an alert for N minutes
 */
function snoozeAlert(alertId, minutes = 60, username, env = 'staging') {
  const target = findAlert(alertId, env);
  if (!target) return null;

  target.status = 'Snoozed';
  target.snoozed_until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  target.acked_by = username;
  if (db && typeof db.persistAlert === 'function') db.persistAlert(target);
  return target;
}

/**
 * Resolve an alert
 */
function resolveAlert(alertId, username, env = 'staging') {
  const target = findAlert(alertId, env);
  if (!target) return null;

  target.status = 'Resolved';
  target.resolved_by = username;
  target.resolved_at = new Date().toISOString();
  target.resolvedAt = target.resolved_at;
  if (db && typeof db.persistAlert === 'function') db.persistAlert(target);
  return target;
}

const alertTransitions = new Map(); // key -> [{ ts, state }]

// Records an alert state change (for flap detection).
function recordAlertTransition(key, state, nowMs = Date.now()) {
  if (!alertTransitions.has(key)) alertTransitions.set(key, []);
  const list = alertTransitions.get(key);
  list.push({ ts: nowMs, state });
  const cutoff = nowMs - 30 * 60 * 1000;
  const pruned = list.filter(t => t.ts >= cutoff);
  alertTransitions.set(key, pruned);

  let changes = 0;
  for (let i = 1; i < pruned.length; i++) {
    if (pruned[i].state !== pruned[i - 1].state) changes++;
  }
  return { changes, isFlapping: changes >= 4 };
}

// True when an alert changed state too often in 30 minutes.
function isAlertFlapping(key, nowMs = Date.now()) {
  const list = alertTransitions.get(key) || [];
  const cutoff = nowMs - 30 * 60 * 1000;
  const pruned = list.filter(t => t.ts >= cutoff);
  let changes = 0;
  for (let i = 1; i < pruned.length; i++) {
    if (pruned[i].state !== pruned[i - 1].state) changes++;
  }
  return changes >= 4;
}

// Clears the flap history.
function clearAlertTransitions() {
  alertTransitions.clear();
}

module.exports = {
  loadRules,
  evaluateRule,
  isInMaintenanceWindow,
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
  recordAlertTransition,
  isAlertFlapping,
  clearAlertTransitions
};
