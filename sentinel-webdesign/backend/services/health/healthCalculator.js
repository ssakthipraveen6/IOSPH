/**
 * healthCalculator.js
 * 
 * Enterprise Health Scoring & Component Status Engine
 * Isolated, deterministic calculation of system health index and component states.
 */

const { SEVERITY, SEVERITY_WEIGHTS, normalizeSeverity } = require('@sentinel/shared-constants');

/**
 * Calculates health index (0 - 100) based on active alerts and simulated outages.
 */
function calculateHealthScore(activeAlerts = [], sims = {}, currentEnv = 'staging') {
  let healthIndex = 100;

  // Deduct for active alerts using canonical weights
  activeAlerts.forEach(alert => {
    const norm = normalizeSeverity(alert.severity);
    healthIndex -= (SEVERITY_WEIGHTS[norm] || 0);
  });

  // Deduct for active simulated outages (only in staging/non-prod)
  if (currentEnv !== 'prod' && sims) {
    Object.keys(sims).forEach(comp => {
      const sim = sims[comp];
      if (!sim) return;
      if (sim.type === 'outage') {
        healthIndex -= 20;
      } else if (sim.type === 'memory_leak' || sim.type === 'disk_full') {
        healthIndex -= 8;
      }
    });
  }

  return Math.max(0, Math.min(100, healthIndex));
}

/**
 * Determines individual component statuses ('Healthy', 'Warning', 'Critical', 'DATA_UNAVAILABLE')
 */
function calculateComponentStatuses({
  components = [],
  activeAlerts = [],
  sims = {},
  currentEnv = 'staging',
  db = null
}) {
  const componentStatuses = {};

  components.forEach(comp => {
    const criticalAlerts = activeAlerts.filter(a => a.component === comp && normalizeSeverity(a.severity) === SEVERITY.CRITICAL);
    const warnAlerts = activeAlerts.filter(a => a.component === comp && (normalizeSeverity(a.severity) === SEVERITY.WARNING || normalizeSeverity(a.severity) === SEVERITY.PREDICTIVE_WARNING));

    if (criticalAlerts.length > 0 || (sims[comp] && sims[comp].type === 'outage')) {
      componentStatuses[comp] = SEVERITY.CRITICAL;
    } else if (warnAlerts.length > 0 || (sims[comp] && sims[comp].type !== 'outage')) {
      componentStatuses[comp] = SEVERITY.WARNING;
    } else {
      if (currentEnv === 'prod' || currentEnv === 'staging') {
        if (db && typeof db.getMetrics === 'function') {
          const recentCompMetrics = db.getMetrics(comp, 10, currentEnv);
          const isAuthFailed = recentCompMetrics.some(m => 
            (m.metricName === 'status' && m.value === 'AUTH_FAILED') ||
            (m.metricName === 'error' && m.value === 'AUTH_FAILED') ||
            m.value === 'AUTH_FAILED'
          );

          if (isAuthFailed) {
            componentStatuses[comp] = SEVERITY.AUTH_FAILED;
          } else {
            const hasLiveFeed = recentCompMetrics.length > 0 && 
              recentCompMetrics.some(m => (typeof m.value === 'number' && !isNaN(m.value)) || (typeof m.value === 'string' && m.value !== 'Data Not Available' && m.value !== 'AUTH_FAILED')) &&
              !recentCompMetrics.some(m => m.value === 'Data Not Available' || m.metricName === 'error');
            componentStatuses[comp] = hasLiveFeed ? SEVERITY.HEALTHY : SEVERITY.DATA_UNAVAILABLE;
          }
        } else {
          componentStatuses[comp] = SEVERITY.HEALTHY;
        }
      } else {
        componentStatuses[comp] = SEVERITY.HEALTHY;
      }
    }
  });

  return componentStatuses;
}

module.exports = {
  calculateHealthScore,
  calculateComponentStatuses
};
