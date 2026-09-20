const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * fortify_collector.js (T2b.2 REMEDIATED)
 * 
 * Micro Focus Fortify SSC Telemetry Collector.
 * Validates authentication status and measures live endpoint latency.
 * Zero Math.random(), zero baseline fallbacks.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.fortify_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Fortify URL not configured for PROD');
      return { scanQueue: null, cpu: null, failures: null, responseTime: null };
    }

    const healthResult = await fetchJsonWithFallback(
      `${url}/auth/isAuthenticated`,
      { headers: { Accept: 'application/json' }, appId: 'fortify' },
      3500
    );

    if (healthResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        scanQueue: null,
        cpu: null,
        failures: null,
        responseTime: null
      };
    }

    if (!healthResult.success) {
      return {
        scanQueue: null,
        cpu: null,
        failures: null,
        responseTime: null
      };
    }

    return {
      scanQueue: null, // SSC /auth endpoint does not expose queue depth
      cpu: null,
      failures: null,
      responseTime: healthResult.latencyMs || null
    };
  }
};
