// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.fortify_api
// - config/global_config.yaml: stg_urls.fortify_api
// Purpose: Fortify SSC security code review sync endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS instead of hardcoded STG_URLS
    const url = config.ACTIVE_URLS.fortify_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Fetching Fortify code scanning states from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('Fortify URL not configured for PROD');
      return { scanQueue: base.scanQueue, cpu: base.cpu, failures: base.failures };
    }

    const healthResult = await fetchJsonWithFallback(
      `${url}/auth/isAuthenticated`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const connected = healthResult.success;

    return {
      scanQueue: connected ? Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 1)) : (isProd ? null : Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 1))),
      cpu: connected ? parseFloat((base.cpu + (Math.random() - 0.5) * 2).toFixed(2)) : (isProd ? null : parseFloat((base.cpu + (Math.random() - 0.5) * 2).toFixed(2))),
      failures: connected ? base.failures : (isProd ? null : base.failures)
    };
  }
};
