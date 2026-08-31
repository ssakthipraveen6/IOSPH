const config = require('../../../config/config');
const credentialProvider = require('../../../config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');

module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.avi_api;

    let globalMetrics = {};
    let aviSecret = null;
    try {
      aviSecret = await credentialProvider.getCredential('avi', 'api');
    } catch (e) {
      // Ignore if not present
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const headers = {};
      if (aviSecret) headers['Authorization'] = `Bearer ${aviSecret}`;

      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(id);

      if (res.ok) {
        const payload = await res.json();
        globalMetrics = payload.metrics || {};
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] Failed connecting to AVI STG URL: ${e.message}. Using baseline.`);
    }

    const result = {
      connections: globalMetrics.connections !== undefined ? globalMetrics.connections : ((base.connections || 1520) + Math.floor((Math.random() - 0.5) * 80)),
      ingressFlow: globalMetrics.ingressFlow !== undefined ? globalMetrics.ingressFlow : parseFloat(((base.ingressFlow || 45.2) + (Math.random() - 0.5) * 2).toFixed(2)),
      throughput: globalMetrics.throughput !== undefined ? globalMetrics.throughput : ((base.throughput || 120) + Math.floor((Math.random() - 0.5) * 5))
    };

    // Dynamically filter all apps with AVI layer configuration
    const aviApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.avi || cfg.avi_api);

    const tasks = aviApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const aviEndpoint = appConfig.layers?.avi?.api || appConfig.avi_api;
      if (!aviEndpoint) return;

      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(aviEndpoint, { signal: controller.signal });
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          const metrics = payload.metrics || {};
          if (metrics.ingressFlow !== undefined) result[`${metricPrefix}_ingressFlow`] = metrics.ingressFlow;
          if (metrics.latency !== undefined) result[`${metricPrefix}_latency`] = metrics.latency;
        } else {
          result[`${metricPrefix}_ingressFlow`] = base[`${metricPrefix}_ingressFlow`] || 15.0;
          result[`${metricPrefix}_latency`] = base[`${metricPrefix}_latency`] || 45.0;
        }
      } catch (e) {
        result[`${metricPrefix}_ingressFlow`] = base[`${metricPrefix}_ingressFlow`] || 15.0;
        result[`${metricPrefix}_latency`] = base[`${metricPrefix}_latency`] || 45.0;
      }
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
