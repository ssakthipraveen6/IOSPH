const config = require('../../../config/config');
const credentialProvider = require('../../../config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');

module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const jdbcString = targetConfig.db_jdbc;

    let dbCredential = null;
    try {
      dbCredential = await credentialProvider.getCredential('database', 'db');
    } catch (e) {
      // Ignore if not present
    }

    const result = {
      cpu: (base.cpu || 32.5) + Math.floor(Math.random() * 5),
      memory: (base.memory || 58.1) + Math.floor(Math.random() * 2),
      transactions: (base.transactions || 450) + Math.floor((Math.random() - 0.5) * 15),
      iops: (base.iops || 800) + Math.floor((Math.random() - 0.5) * 20)
    };

    // Dynamically filter all apps with DB layer configuration
    const dbApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.db || cfg.db_jdbc);

    const tasks = dbApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const jdbc = appConfig.layers?.db?.jdbc || appConfig.db_jdbc;
      const purpose = appConfig.layers?.db?.credential_purpose;

      if (purpose) {
        try {
          await credentialProvider.getCredential(appKey, purpose);
        } catch (e) {
          // ignore fallback
        }
      }

      result[`${metricPrefix}_connections`] = base[`${metricPrefix}_connections`] || 45;
      result[`${metricPrefix}_tps`] = base[`${metricPrefix}_tps`] || 180;
      result[`${metricPrefix}_dbLatency`] = parseFloat(((base[`${metricPrefix}_dbLatency`] || 12.4) + Math.random() * 0.5).toFixed(2));
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
