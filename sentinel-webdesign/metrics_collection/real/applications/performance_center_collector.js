const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * performance_center_collector.js (T2b.2 REMEDIATED)
 * 
 * Performance Center Load Testing Telemetry Collector.
 * Metrics parsed from /api/status endpoint or null.
 * Latency measured via fetch timer. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const url = targetConfig.performance_center_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Performance Center URL not configured for PROD');
      return { activeTests: null, avgResponseTime: null, throughput: null };
    }

    const result = await fetchJsonWithFallback(
      `${url}/api/status`,
      { headers: { Accept: 'application/json' }, appId: 'performance_center' },
      3500
    );

    if (result.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        activeTests: null,
        avgResponseTime: null,
        throughput: null
      };
    }

    if (!result.success) {
      return {
        activeTests: null,
        avgResponseTime: null,
        throughput: null
      };
    }

    return {
      activeTests: typeof result.data?.activeTests === 'number' ? result.data.activeTests : null,
      avgResponseTime: typeof result.data?.avgResponseTime === 'number' ? result.data.avgResponseTime : (result.latencyMs || null),
      throughput: typeof result.data?.throughput === 'number' ? result.data.throughput : null
    };
  }
};
