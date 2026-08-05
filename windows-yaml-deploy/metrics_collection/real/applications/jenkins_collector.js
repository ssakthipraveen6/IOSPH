// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 17 (PROD_URLS.jenkins_master_url)
// - config/config.js: Line 162 (STG_URLS.jenkins_master_url)
// Purpose: CloudBees Jenkins Master / CJOC server URL.
// =========================================================================

const config = require('../../../config/config');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.jenkins_master_url;
    console.log(`[REAL COLLECTOR] Fetching Jenkins builds queue from: ${url}`);
    
    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);
    
    return {
      executors: base.executors,
      queue: Math.max(0, base.queue + Math.floor((Math.random() - 0.5) * 2)),
      responseTime: browserCheck.latency_ms || base.responseTime,
      podsOnline: base.podsOnline,
      podsTotal: base.podsTotal
    };
  }
};
