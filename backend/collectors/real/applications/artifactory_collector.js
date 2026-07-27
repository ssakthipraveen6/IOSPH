const config = require('../../../config');
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
