const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * nexusiq_collector.js (T2b.2 REMEDIATED)
 * 
 * Sonatype Nexus IQ Server Telemetry Collector.
 * Probes /healthcheck with real latency measurement.
 * Zero Math.random(), zero baseline fallbacks.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.nexusiq_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('NexusIQ URL not configured for PROD');
      return { scanQueue: null, violations: null, responseTime: null };
    }

    const healthResult = await fetchJsonWithFallback(
      `${url}/healthcheck`,
      { headers: { Accept: 'application/json' }, appId: 'nexusiq' },
      3500
    );

    if (healthResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        scanQueue: null,
        violations: null,
        responseTime: null
      };
    }

    if (!healthResult.success) {
      return {
        scanQueue: null,
        violations: null,
        responseTime: null
      };
    }

    return {
      scanQueue: null, // /healthcheck exposes component booleans, not scan queue
      violations: null,
      responseTime: healthResult.latencyMs || null
    };
  }
};
