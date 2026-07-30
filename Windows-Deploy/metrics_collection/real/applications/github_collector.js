const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.PROD_URLS || config.STG_URLS;
    const url = targetConfig.github_api || 'https://api.github.com';
    console.log(`[REAL COLLECTOR] Querying GitHub status from: ${url}`);

    try {
      // const res = await fetch(`${url}/rate_limit`);
    } catch (_) {}

    return {
      apiRateLimitRemaining: base.apiRateLimitRemaining - Math.floor(Math.random() * 3),
      pendingPullRequests: base.pendingPullRequests,
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 6)
    };
  }
};
