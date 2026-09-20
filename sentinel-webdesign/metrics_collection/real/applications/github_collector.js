const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * github_collector.js (T2b.2 REMEDIATED)
 * 
 * GitHub Enterprise Server Telemetry Collector.
 * Metrics parsed from /rate_limit endpoint or null.
 * Response time measured from real fetch latency. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.github_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('GitHub URL not configured for PROD');
      return {
        apiRateLimitRemaining: null,
        pendingPullRequests: null,
        responseTime: null
      };
    }

    const result = await fetchJsonWithFallback(
      `${url}/rate_limit`,
      { headers: { Accept: 'application/json' }, appId: 'github' },
      3500
    );

    if (result.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        apiRateLimitRemaining: null,
        pendingPullRequests: null,
        responseTime: null
      };
    }

    if (!result.success) {
      return {
        apiRateLimitRemaining: null,
        pendingPullRequests: null,
        responseTime: null
      };
    }

    const rateLimitRemaining = typeof result.data?.rate?.remaining === 'number'
      ? result.data.rate.remaining
      : null;

    return {
      apiRateLimitRemaining: rateLimitRemaining,
      pendingPullRequests: null, // Not exposed by /rate_limit
      responseTime: result.latencyMs || null
    };
  }
};
