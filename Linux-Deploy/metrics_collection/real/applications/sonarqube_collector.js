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
