/**
 * SLO tracking: loads SLO definitions and evaluates them against stored metrics.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const db = require('@sentinel/database');

const SLO_CONFIG_PATH = path.resolve(__dirname, '../../../config/slos.yaml');

// Loads the SLO definitions.
function loadSloConfig() {
  try {
    if (fs.existsSync(SLO_CONFIG_PATH)) {
      return yaml.load(fs.readFileSync(SLO_CONFIG_PATH, 'utf8'));
    }
  } catch (_) {}
  return {
    version: '1.0',
    window_days: 30,
    slos: [
      { id: 'sentinel_api_availability', name: 'Sentinel API Availability', target_percentage: 99.9 },
      { id: 'alert_detection_latency', name: 'Alert Detection Latency', target_percentage: 95.0, target_p95_seconds: 30 },
      { id: 'autonomous_recovery_success_rate', name: 'Recovery Success Rate', target_percentage: 95.0 }
    ]
  };
}

/**
 * Calculates current SLI and error budget for all configured SLOs
 */
function evaluateSlos(environment = 'staging') {
  const config = loadSloConfig();
  const recoveries = db.getRecoveryLogs(environment) || [];
  const alerts = db.getAlerts(environment) || [];

  const results = config.slos.map(slo => {
    let currentSli = null;
    let budgetTotal = 100 - slo.target_percentage;
    let errorBudgetRemaining = null;
    let status = 'UNKNOWN';
    let burnRate = null;

    if (slo.id === 'autonomous_recovery_success_rate') {
      const completed = recoveries.filter(r => r.status === 'Success' || r.status === 'Failed');
      if (completed.length > 0) {
        const successes = completed.filter(r => r.status === 'Success').length;
        currentSli = parseFloat(((successes / completed.length) * 100).toFixed(2));
        const budgetSpent = Math.max(0, 100 - currentSli);
        errorBudgetRemaining = parseFloat(Math.max(0, (1 - (budgetSpent / (budgetTotal || 0.01))) * 100).toFixed(2));
        burnRate = currentSli < slo.target_percentage ? parseFloat(((slo.target_percentage - currentSli) / (budgetTotal || 0.01)).toFixed(2)) : 0.0;
        status = errorBudgetRemaining <= 0 ? 'BUDGET_EXHAUSTED' : (errorBudgetRemaining < 25 || burnRate > 2.0) ? 'DEGRADED' : 'HEALTHY';
      }
    } else if (slo.id === 'alert_detection_latency') {
      const withEventTime = alerts.filter(a => a && a.event_time != null && a.timestamp != null);
      if (withEventTime.length > 0) {
        const targetSeconds = slo.target_p95_seconds || 30;
        const withinTarget = withEventTime.filter(a => {
          let ts = typeof a.timestamp === 'number' ? a.timestamp : (new Date(a.timestamp).getTime() / 1000);
          let et = typeof a.event_time === 'number' ? a.event_time : (new Date(a.event_time).getTime() / 1000);
          if (ts > 1e11) ts /= 1000;
          if (et > 1e11) et /= 1000;
          return (ts - et) <= targetSeconds;
        }).length;
        currentSli = parseFloat(((withinTarget / withEventTime.length) * 100).toFixed(2));
        const budgetSpent = Math.max(0, 100 - currentSli);
        errorBudgetRemaining = parseFloat(Math.max(0, (1 - (budgetSpent / (budgetTotal || 0.01))) * 100).toFixed(2));
        burnRate = currentSli < slo.target_percentage ? parseFloat(((slo.target_percentage - currentSli) / (budgetTotal || 0.01)).toFixed(2)) : 0.0;
        status = errorBudgetRemaining <= 0 ? 'BUDGET_EXHAUSTED' : (errorBudgetRemaining < 25 || burnRate > 2.0) ? 'DEGRADED' : 'HEALTHY';
      }
    }

    return {
      id: slo.id,
      name: slo.name,
      target_percentage: slo.target_percentage,
      current_sli: currentSli,
      error_budget_remaining_percent: errorBudgetRemaining,
      burn_rate: burnRate,
      status,
      environment
    };
  });

  return {
    evaluated_at: new Date().toISOString(),
    environment,
    window_days: config.window_days || 30,
    slos: results
  };
}

module.exports = {
  loadSloConfig,
  evaluateSlos
};
