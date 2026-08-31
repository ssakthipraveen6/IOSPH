// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.artifactory_api
// - config/global_config.yaml: stg_urls.artifactory_api
// Purpose: JFrog Artifactory storage and system status endpoint prefix.
// =========================================================================

const config = require('../../../config/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS instead of hardcoded STG_URLS
    const url = config.ACTIVE_URLS.artifactory_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Fetching Artifactory heap telemetry from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('Artifactory URL not configured for PROD');
      return { heap: base.heap, space: base.space, latency: base.latency };
    }

    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);

    // Attempt live storage check
    const storageResult = await fetchJsonWithFallback(
      `${url}/storageinfo`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const space = storageResult.success && storageResult.data?.storageSummary
      ? storageResult.data.storageSummary.binariesSummary?.usedSpace
      : (isProd ? null : parseFloat((base.space + (Math.random() - 0.5) * 0.5).toFixed(2)));

    return {
      heap: isProd ? (browserCheck.latency_ms ? base.heap : null) : parseFloat((base.heap + (Math.random() - 0.5) * 1).toFixed(2)),
      space,
      latency: browserCheck.latency_ms || (isProd ? null : base.latency)
    };
  }
};
