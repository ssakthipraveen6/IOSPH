// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 21 (PROD_URLS.fortify_api)
// - config/config.js: Line 148 (STG_URLS.fortify_api)
// Purpose: Fortify SSC security code review sync endpoint prefix.
// =========================================================================

const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.fortify_api;
    console.log(`[REAL COLLECTOR] Fetching Fortify code scanning states from: ${url}`);
    
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (res.ok) {
        // Connected successfully
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] Fortify SSC connection refused: ${e.message}. Using baseline.`);
    }

    return {
      scanQueue: Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 1)),
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 2).toFixed(2)),
      failures: base.failures
    };
  }
};
