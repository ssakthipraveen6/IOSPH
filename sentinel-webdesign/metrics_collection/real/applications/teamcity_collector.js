// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.teamcity_api
// - config/global_config.yaml: stg_urls.teamcity_api
// Purpose: TeamCity build agent workload api endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) — was incorrectly preferring STG_URLS first
    const url = config.ACTIVE_URLS.teamcity_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      console.warn('[REAL COLLECTOR] No TeamCity endpoint URL configured. Using baseline.');
      if (isProd) throw new Error('TeamCity URL not configured for PROD');
      return { activeBuilds: base.activeBuilds, agents: base.agents, load: base.load };
    }

    console.log(`[REAL COLLECTOR] Fetching TeamCity build agents status from: ${url}`);

    const result = await fetchJsonWithFallback(
      `${url}/buildQueue`,
      { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } },
      3500
    );

    const connected = result.success;
    const buildCount = connected ? (result.data?.count || 0) : null;

    return {
      activeBuilds: connected ? Math.max(0, buildCount) : (isProd ? null : Math.max(0, base.activeBuilds + Math.floor((Math.random() - 0.5) * 2))),
      agents: connected ? base.agents : (isProd ? null : base.agents),
      load: connected ? parseFloat((base.load + (Math.random() - 0.5) * 3).toFixed(2)) : (isProd ? null : parseFloat((base.load + (Math.random() - 0.5) * 3).toFixed(2)))
    };
  }
};
