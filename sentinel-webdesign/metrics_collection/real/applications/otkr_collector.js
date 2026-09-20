const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * otkr_collector.js (T2b.2 REMEDIATED)
 * 
 * OTKR Security Scanner Telemetry Collector.
 * Metrics parsed from /status endpoint or null.
 * Real latency measured via fetch timer. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const url = targetConfig.otkr_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('OTKR URL not configured for PROD');
      return { scanQueue: null, findings: null, responseTime: null };
    }

    const result = await fetchJsonWithFallback(
      `${url}/status`,
      { headers: { Accept: 'application/json' }, appId: 'otkr' },
      3500
    );

    if (result.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        scanQueue: null,
        findings: null,
        responseTime: null
      };
    }

    if (!result.success) {
      return {
        scanQueue: null,
        findings: null,
        responseTime: null
      };
    }

    return {
      scanQueue: typeof result.data?.scanQueue === 'number' ? result.data.scanQueue : null,
      findings: typeof result.data?.findings === 'number' ? result.data.findings : null,
      responseTime: result.latencyMs || null
    };
  }
};
