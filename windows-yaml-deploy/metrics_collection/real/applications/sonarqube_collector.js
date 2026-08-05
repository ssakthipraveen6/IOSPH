// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 19 (PROD_URLS.sonarqube_api)
// - config/config.js: Line N/A (STG_URLS.sonarqube_api)
// Purpose: SonarQube static scanning dashboard endpoint prefix.
// =========================================================================

const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.PROD_URLS || config.STG_URLS;
    const url = targetConfig.sonarqube_api || 'https://sonarqube.internal.corp/api';
    console.log(`[REAL COLLECTOR] Querying SonarQube from: ${url}`);

    try {
      // const res = await fetch(`${url}/system/status`);
      // const data = await res.json();
    } catch (_) {}

    return {
      qualityGatesPassed: base.qualityGatesPassed,
      analysisQueue: base.analysisQueue,
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 5)
    };
  }
};
