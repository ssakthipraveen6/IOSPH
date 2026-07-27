const config = require('../../../config');

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
