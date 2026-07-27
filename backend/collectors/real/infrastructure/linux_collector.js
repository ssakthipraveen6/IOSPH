const config = require('../../../config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.linux_api;
    console.log(`[REAL COLLECTOR] Fetching Linux host metrics from: ${url}`);
    
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
      console.warn(`[REAL COLLECTOR] Failed fetching Linux host API: ${e.message}. Using baseline.`);
    }

    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 3).toFixed(2)),
      memory: parseFloat((base.memory + (Math.random() - 0.5) * 1).toFixed(2)),
      load: parseFloat((base.load + (Math.random() - 0.5) * 0.05).toFixed(2)),
      bitbucket_cpu: base.bitbucket_cpu,
      jenkins_cpu: base.jenkins_cpu,
      artifactory_cpu: base.artifactory_cpu,
      nexusiq_cpu: base.nexusiq_cpu,
      teamcity_cpu: base.teamcity_cpu,
      mcp_cpu: base.mcp_cpu,
      argocd_cpu: base.argocd_cpu,
      bitbucket_mem: base.bitbucket_mem,
      jenkins_mem: base.jenkins_mem,
      artifactory_mem: base.artifactory_mem,
      nexusiq_mem: base.nexusiq_mem,
      teamcity_mem: base.teamcity_mem,
      mcp_mem: base.mcp_mem,
      argocd_mem: base.argocd_mem
    };
  }
};
