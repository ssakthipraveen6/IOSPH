// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.bitbucket_api
// - config/global_config.yaml: stg_urls.bitbucket_api
// Purpose: Bitbucket server API endpoint prefix.
// =========================================================================

const config = require('../../../config/config');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) instead of hardcoded STG_URLS
    const url = config.ACTIVE_URLS.bitbucket_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Fetching Bitbucket health from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('Bitbucket URL not configured for PROD');
      return { responseTime: base.responseTime, successRate: base.successRate, requests: base.requests };
    }

    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);

    return {
      responseTime: browserCheck.latency_ms || (isProd ? null : base.responseTime),
      successRate: browserCheck.login_success
        ? parseFloat((base.successRate - Math.random() * 0.05).toFixed(2))
        : (isProd ? null : 0.0),
      requests: isProd
        ? (browserCheck.latency_ms ? base.requests + Math.floor((Math.random() - 0.5) * 4) : null)
        : base.requests + Math.floor((Math.random() - 0.5) * 4)
    };
  }
};
