const config = require('../../../config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.avi_api;
    console.log(`[REAL COLLECTOR] Fetching load balancer telemetry from: ${url}`);
    
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (res.ok) {
        const payload = await res.json();
        return payload.metrics;
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] Failed connecting to AVI STG URL: ${e.message}. Using baseline.`);
    }

    // Fallback baseline
    return {
      connections: base.connections + Math.floor((Math.random() - 0.5) * 80),
      ingressFlow: parseFloat((base.ingressFlow + (Math.random() - 0.5) * 2).toFixed(2)),
      throughput: base.throughput + Math.floor((Math.random() - 0.5) * 5),
      bitbucket_ingressFlow: base.bitbucket_ingressFlow,
      jenkins_ingressFlow: base.jenkins_ingressFlow,
      artifactory_ingressFlow: base.artifactory_ingressFlow,
      argocd_ingressFlow: base.argocd_ingressFlow,
      bitbucket_latency: base.bitbucket_latency,
      jenkins_latency: base.jenkins_latency,
      artifactory_latency: base.artifactory_latency,
      argocd_latency: base.argocd_latency
    };
  }
};
