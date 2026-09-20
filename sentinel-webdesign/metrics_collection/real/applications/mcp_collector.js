const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * mcp_collector.js (T2b.2 REMEDIATED)
 * 
 * MCP Gateway / Microservices Platform Telemetry Collector.
 * Metrics parsed from /status endpoint or null.
 * Latency measured via fetch timer. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const url = targetConfig.mcp_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('MCP Gateway URL not configured for PROD');
      return { cpu: null, latency: null, replicas: null };
    }

    const result = await fetchJsonWithFallback(
      `${url}/status`,
      { headers: { Accept: 'application/json' }, appId: 'mcp' },
      3500
    );

    if (result.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        cpu: null,
        latency: null,
        replicas: null
      };
    }

    if (!result.success) {
      return {
        cpu: null,
        latency: null,
        replicas: null
      };
    }

    return {
      cpu: typeof result.data?.cpu === 'number' ? result.data.cpu : null,
      latency: result.latencyMs || null,
      replicas: typeof result.data?.replicas === 'number' ? result.data.replicas : null
    };
  }
};
