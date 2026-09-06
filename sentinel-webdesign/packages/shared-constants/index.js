/**
 * @sentinel/shared-constants
 * 
 * Canonical single source of truth for severity, operational status,
 * UI color mapping, health penalty weighting, and Incident Priority.
 * Eliminates sev / severity / priority naming drift across the stack.
 */

const SEVERITY = Object.freeze({
  CRITICAL: 'Critical',
  WARNING: 'Warning',
  PREDICTIVE_WARNING: 'Predictive-Warning',
  HEALTHY: 'Healthy',
  INFO: 'Info',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE'
});

const SEVERITY_COLORS = Object.freeze({
  [SEVERITY.CRITICAL]: '#ef4444',
  [SEVERITY.WARNING]: '#f59e0b',
  [SEVERITY.PREDICTIVE_WARNING]: '#f59e0b',
  [SEVERITY.HEALTHY]: '#10b981',
  [SEVERITY.INFO]: '#3b82f6',
  [SEVERITY.DATA_UNAVAILABLE]: '#94a3b8'
});

const SEVERITY_WEIGHTS = Object.freeze({
  [SEVERITY.CRITICAL]: 15,
  [SEVERITY.WARNING]: 6,
  [SEVERITY.PREDICTIVE_WARNING]: 3,
  [SEVERITY.HEALTHY]: 0,
  [SEVERITY.INFO]: 0,
  [SEVERITY.DATA_UNAVAILABLE]: 0
});

const INCIDENT_PRIORITY = Object.freeze({
  P1: 'P1 - CRITICAL',
  P2: 'P2 - HIGH',
  P3: 'P3 - MODERATE',
  P4: 'P4 - LOW'
});

/**
 * Normalizes any severity string representation to canonical SEVERITY enum.
 * @param {string} raw 
 * @returns {string}
 */
function normalizeSeverity(raw) {
  if (!raw) return SEVERITY.INFO;
  const s = String(raw).trim().toLowerCase();
  if (s === 'critical' || s === 'crit' || s === 'p1') return SEVERITY.CRITICAL;
  if (s === 'warning' || s === 'warn' || s === 'p2') return SEVERITY.WARNING;
  if (s === 'predictive-warning' || s === 'predictive_warning') return SEVERITY.PREDICTIVE_WARNING;
  if (s === 'healthy' || s === 'ok' || s === 'optimal') return SEVERITY.HEALTHY;
  if (s === 'data_unavailable' || s === 'no_data' || s === 'data not available') return SEVERITY.DATA_UNAVAILABLE;
  return SEVERITY.INFO;
}

/**
 * Returns canonical CSS hex color for a given status or severity.
 * @param {string} status 
 * @returns {string}
 */
function getStatusColor(status) {
  const norm = normalizeSeverity(status);
  return SEVERITY_COLORS[norm] || '#94a3b8';
}

module.exports = {
  SEVERITY,
  SEVERITY_COLORS,
  SEVERITY_WEIGHTS,
  INCIDENT_PRIORITY,
  normalizeSeverity,
  getStatusColor
};
