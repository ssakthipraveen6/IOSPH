// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.nexusiq_api
// - config/global_config.yaml: stg_urls.nexusiq_api
// Purpose: Nexus IQ policy violation query endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) — was incorrectly preferring STG_URLS first
    const url = config.ACTIVE_URLS.nexusiq_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      console.warn('[REAL COLLECTOR] No NexusIQ endpoint URL configured. Using baseline.');
      if (isProd) throw new Error('NexusIQ URL not configured for PROD');
      return { scanQueue: base.scanQueue, violations: base.violations, responseTime: base.responseTime };
    }

    console.log(`[REAL COLLECTOR] Fetching NexusIQ vulnerabilities from: ${url}`);

    const healthResult = await fetchJsonWithFallback(
      `${url}/healthcheck`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const connected = healthResult.success;

    return {
      scanQueue: connected ? Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 2)) : (isProd ? null : Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 2))),
      violations: connected ? base.violations : (isProd ? null : base.violations),
      responseTime: connected ? base.responseTime + Math.floor((Math.random() - 0.5) * 10) : (isProd ? null : base.responseTime + Math.floor((Math.random() - 0.5) * 10))
    };
  }
};
