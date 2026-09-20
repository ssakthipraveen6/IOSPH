/**
 * Collector Contract (T2b.1)
 * Standard response envelope and truthfulness contract for all Sentinel collectors.
 * 
 * Rules:
 * 1. No Math.random() anywhere under real/ collectors.
 * 2. No numeric literal may reach a returned metric value. Every number is parsed or null.
 * 3. Real latency measured via performance.now() around fetch.
 */

const STATUS = {
  OK: 'OK',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  AUTH_FAILED: 'AUTH_FAILED',
  DISABLED: 'DISABLED'
};

const SOURCE = {
  LIVE: 'live',
  NONE: 'none'
};

/**
 * Creates a compliant collector result object.
 * @param {Object} params
 * @param {string} params.status - 'OK' | 'DATA_UNAVAILABLE' | 'AUTH_FAILED' | 'DISABLED'
 * @param {Object.<string, number|null>} params.metrics - Map of metric names to values or null
 * @param {string} params.source - 'live' | 'none'
 * @param {string} [params.observedAt] - ISO timestamp
 * @param {string|null} [params.error] - Failure reason if any
 */
function createCollectorEnvelope({
  status = STATUS.OK,
  metrics = {},
  source = SOURCE.LIVE,
  observedAt = new Date().toISOString(),
  error = null
}) {
  return {
    status,
    metrics,
    source,
    observedAt,
    error
  };
}

module.exports = {
  STATUS,
  SOURCE,
  createCollectorEnvelope
};
