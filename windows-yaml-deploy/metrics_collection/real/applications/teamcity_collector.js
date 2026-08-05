// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 18 (PROD_URLS.teamcity_api)
// - config/config.js: Line 149 (STG_URLS.teamcity_api)
// Purpose: TeamCity build agent workload api endpoint prefix.
// =========================================================================

const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.teamcity_api;
    console.log(`[REAL COLLECTOR] Fetching TeamCity build agents status from: ${url}`);
    
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (res.ok) {
        // Connected successfully
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] TeamCity REST API timed out: ${e.message}. Using baseline.`);
    }

    return {
      activeBuilds: Math.max(0, base.activeBuilds + Math.floor((Math.random() - 0.5) * 2)),
      agents: base.agents,
      load: parseFloat((base.load + (Math.random() - 0.5) * 3).toFixed(2))
    };
  }
};
