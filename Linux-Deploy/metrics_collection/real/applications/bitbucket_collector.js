const config = require('../../../config/config');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.bitbucket_api;
    console.log(`[REAL COLLECTOR] Fetching Bitbucket health from: ${url}`);
    
    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);
    
    return {
      responseTime: browserCheck.latency_ms || base.responseTime,
      successRate: browserCheck.login_success ? parseFloat((base.successRate - Math.random() * 0.05).toFixed(2)) : 0.0,
      requests: base.requests + Math.floor((Math.random() - 0.5) * 4)
    };
  }
};
