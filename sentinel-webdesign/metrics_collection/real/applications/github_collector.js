// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.github_api
// - config/global_config.yaml: stg_urls.github_api
// Purpose: GitHub Enterprise server API endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) — was always preferring PROD_URLS
    const url = config.ACTIVE_URLS.github_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Querying GitHub status from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('GitHub URL not configured for PROD');
      return {
        apiRateLimitRemaining: base.apiRateLimitRemaining - Math.floor(Math.random() * 3),
        pendingPullRequests: base.pendingPullRequests,
        responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 6)
      };
    }

    // [FIX-8] Enable real rate_limit fetch (was commented out)
    const result = await fetchJsonWithFallback(
      `${url}/rate_limit`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const connected = result.success;
    const rateLimitRemaining = connected ? (result.data?.rate?.remaining ?? null) : null;

    return {
      apiRateLimitRemaining: connected
        ? rateLimitRemaining
        : (isProd ? null : base.apiRateLimitRemaining - Math.floor(Math.random() * 3)),
      pendingPullRequests: isProd ? (connected ? base.pendingPullRequests : null) : base.pendingPullRequests,
      responseTime: connected
        ? base.responseTime + Math.floor((Math.random() - 0.5) * 6)
        : (isProd ? null : base.responseTime + Math.floor((Math.random() - 0.5) * 6))
    };
  }
};
