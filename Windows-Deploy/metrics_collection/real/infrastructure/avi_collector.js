const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.STG_URLS || config.PROD_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.avi_api;
    console.log(`[REAL COLLECTOR] Fetching load balancer telemetry from: ${url}`);
    
    let globalMetrics = {};
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (res.ok) {
        const payload = await res.json();
        globalMetrics = payload.metrics || {};
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] Failed connecting to AVI STG URL: ${e.message}. Using baseline.`);
    }

    const result = {
      connections: globalMetrics.connections !== undefined ? globalMetrics.connections : (base.connections + Math.floor((Math.random() - 0.5) * 80)),
      ingressFlow: globalMetrics.ingressFlow !== undefined ? globalMetrics.ingressFlow : parseFloat((base.ingressFlow + (Math.random() - 0.5) * 2).toFixed(2)),
      throughput: globalMetrics.throughput !== undefined ? globalMetrics.throughput : (base.throughput + Math.floor((Math.random() - 0.5) * 5)),
      bitbucket_ingressFlow: base.bitbucket_ingressFlow,
      jenkins_ingressFlow: base.jenkins_ingressFlow,
      artifactory_ingressFlow: base.artifactory_ingressFlow,
      argocd_ingressFlow: base.argocd_ingressFlow,
      bitbucket_latency: base.bitbucket_latency,
      jenkins_latency: base.jenkins_latency,
      artifactory_latency: base.artifactory_latency,
      argocd_latency: base.argocd_latency
    };

    const aviApps = ['bitbucket', 'jenkins_k8s', 'artifactory', 'argocd_k8s'];
    for (const appKey of aviApps) {
      const metricPrefix = appKey.replace('_k8s', '');
      const appConfig = appConfigs[appKey];
      if (appConfig && appConfig.avi_api) {
        console.log(`[REAL COLLECTOR] Fetching load balancer telemetry for ${appKey} from: ${appConfig.avi_api}`);
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1500);
          const res = await fetch(appConfig.avi_api, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            const metrics = payload.metrics || {};
            if (metrics.ingressFlow !== undefined) result[`${metricPrefix}_ingressFlow`] = metrics.ingressFlow;
            if (metrics.latency !== undefined) result[`${metricPrefix}_latency`] = metrics.latency;
          }
        } catch (e) {
          console.warn(`[REAL COLLECTOR] Failed fetching load balancer telemetry for ${appKey}: ${e.message}`);
        }
      }
    }

    return result;
  }
};
