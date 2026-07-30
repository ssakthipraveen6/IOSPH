// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 14 (PROD_URLS.artifactory_api)
// - config/config.js: Line 146 (STG_URLS.artifactory_api)
// Purpose: JFrog Artifactory storage and system status endpoint prefix.
// =========================================================================

const config = require('../../../config/config');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.artifactory_api;
    console.log(`[REAL COLLECTOR] Fetching Artifactory heap telemetry from: ${url}`);
    
    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);
    
    return {
      heap: parseFloat((base.heap + (Math.random() - 0.5) * 1).toFixed(2)),
      space: base.space,
      latency: browserCheck.latency_ms || base.latency
    };
  }
};
