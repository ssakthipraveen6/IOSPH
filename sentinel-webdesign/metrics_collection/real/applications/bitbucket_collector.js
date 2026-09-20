const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const { runSeleniumCheck } = require('../python_checks/runner');

/**
 * bitbucket_collector.js (T2b.2 REMEDIATED)
 * 
 * Atlassian Bitbucket Server Telemetry Collector.
 * Probes /status with real latency measurement and authentication detection.
 * Zero Math.random(), zero synthetic fallback values.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.bitbucket_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Bitbucket URL not configured for PROD');
      return { responseTime: null, successRate: null, requests: null };
    }

    const apiResult = await fetchJsonWithFallback(
      `${url}/status`,
      { headers: { Accept: 'application/json' }, appId: 'bitbucket' },
      3500
    );

    if (apiResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        responseTime: null,
        successRate: null,
        requests: null
      };
    }

    // Perform active Selenium browser load latency check
    let browserCheck = { latency_ms: null, login_success: null };
    try {
      browserCheck = await runSeleniumCheck(url);
    } catch (_) {}

    const measuredLatency = browserCheck.latency_ms || apiResult.latencyMs || null;
    let successRate = null;
    if (browserCheck.login_success !== null && browserCheck.login_success !== undefined) {
      successRate = browserCheck.login_success ? 100.0 : 0.0;
    } else if (apiResult.success) {
      successRate = 100.0;
    }

    return {
      responseTime: measuredLatency,
      successRate,
      requests: null // Not exposed by Bitbucket status endpoint
    };
  }
};
