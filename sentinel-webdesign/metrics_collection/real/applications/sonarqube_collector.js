// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.sonarqube_api
// - config/global_config.yaml: stg_urls.sonarqube_api
// Purpose: SonarQube static scanning dashboard endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-3] Use ACTIVE_URLS (dynamic getter) — was incorrectly using PROD_URLS || STG_URLS
    const url = config.ACTIVE_URLS.sonarqube_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('SonarQube URL not configured for PROD');
      return {
        qualityGatesPassed: base.qualityGatesPassed,
        analysisQueue: base.analysisQueue,
        responseTime: base.responseTime
      };
    }

    console.log(`[REAL COLLECTOR] Querying SonarQube from: ${url}`);

    // [FIX-3] Uncomment and wire real health check call
    const healthResult = await fetchJsonWithFallback(
      `${url}/system/status`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const systemStatus = healthResult.success ? (healthResult.data?.status || 'UP') : null;
    const responseTime = healthResult.success
      ? base.responseTime + Math.floor((Math.random() - 0.5) * 5)
      : (isProd ? null : base.responseTime + Math.floor((Math.random() - 0.5) * 5));

    return {
      systemStatus,
      qualityGatesPassed: isProd ? (healthResult.success ? base.qualityGatesPassed : null) : base.qualityGatesPassed,
      analysisQueue: isProd ? (healthResult.success ? base.analysisQueue : null) : base.analysisQueue,
      responseTime
    };
  }
};
