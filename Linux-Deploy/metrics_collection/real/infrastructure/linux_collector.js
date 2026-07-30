const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.STG_URLS || config.PROD_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.linux_api || targetConfig.unix_api;
    console.log(`[REAL COLLECTOR] Fetching Linux host metrics from: ${url}`);
    
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
      console.warn(`[REAL COLLECTOR] Failed fetching Linux host API: ${e.message}. Using baseline.`);
    }

    const result = {
      cpu: globalMetrics.cpu !== undefined ? globalMetrics.cpu : parseFloat((base.cpu + (Math.random() - 0.5) * 3).toFixed(2)),
      memory: globalMetrics.memory !== undefined ? globalMetrics.memory : parseFloat((base.memory + (Math.random() - 0.5) * 1).toFixed(2)),
      load: globalMetrics.load !== undefined ? globalMetrics.load : parseFloat((base.load + (Math.random() - 0.5) * 0.05).toFixed(2)),
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

    const appKeys = ['bitbucket', 'jenkins_k8s', 'artifactory', 'nexusiq', 'teamcity', 'mcp_server_k8s', 'argocd_k8s'];
    for (const appKey of appKeys) {
      const metricPrefix = appKey.replace('_k8s', '').replace('_server', '');
      const appConfig = appConfigs[appKey];
      if (appConfig) {
        if (appConfig.servers) {
          const linuxServers = appConfig.servers.filter(s => s.type === 'linux');
          if (linuxServers.length > 0) {
            const promises = linuxServers.map(async (server) => {
              console.log(`[REAL COLLECTOR] Fetching Linux host metrics for ${appKey} node ${server.node} from: ${server.api}`);
              const controller = new AbortController();
              const id = setTimeout(() => controller.abort(), 1500);
              try {
                const res = await fetch(server.api, { signal: controller.signal });
                clearTimeout(id);
                if (res.ok) {
                  const payload = await res.json();
                  return payload.metrics || null;
                }
              } catch (e) {
                console.warn(`[REAL COLLECTOR] Failed fetching Linux host API for ${appKey} node ${server.node}: ${e.message}`);
              }
              return null;
            });

            const results = await Promise.all(promises);
            const validResults = results.filter(r => r !== null);
            if (validResults.length > 0) {
              const sumCpu = validResults.reduce((acc, r) => acc + (r.cpu !== undefined ? r.cpu : 0), 0);
              const sumMem = validResults.reduce((acc, r) => acc + (r.memory !== undefined ? r.memory : 0), 0);
              result[`${metricPrefix}_cpu`] = parseFloat((sumCpu / validResults.length).toFixed(2));
              result[`${metricPrefix}_mem`] = parseFloat((sumMem / validResults.length).toFixed(2));
            }
          }
        } else if (appConfig.linux_api) {
          console.log(`[REAL COLLECTOR] Fetching Linux host metrics for ${appKey} from: ${appConfig.linux_api}`);
          try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(appConfig.linux_api, { signal: controller.signal });
            clearTimeout(id);
            if (res.ok) {
              const payload = await res.json();
              const metrics = payload.metrics || {};
              if (metrics.cpu !== undefined) result[`${metricPrefix}_cpu`] = metrics.cpu;
              if (metrics.memory !== undefined) result[`${metricPrefix}_mem`] = metrics.memory;
            }
          } catch (e) {
            console.warn(`[REAL COLLECTOR] Failed fetching Linux host API for ${appKey}: ${e.message}`);
          }
        }
      }
    }

    return result;
  }
};
