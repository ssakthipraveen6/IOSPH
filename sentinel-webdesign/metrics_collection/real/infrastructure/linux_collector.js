const config = require('@sentinel/config');

/**
 * linux_collector.js (T2b.2 REMEDIATED)
 * 
 * Linux/Unix compute CPU, memory, and load telemetry collector.
 * All metrics parsed directly from host endpoints or null.
 * Zero Math.random(), zero synthetic fallback values.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.linux_api || targetConfig.unix_api;
    const isOutage = simulations && simulations.linux_servers && simulations.linux_servers.type === 'outage';

    let globalMetrics = null;
    if (url && !isOutage) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        
        if (res.ok) {
          const payload = await res.json();
          globalMetrics = payload.metrics || payload;
        }
      } catch (e) {
        // unreachable
      }
    }

    const result = {
      cpu: isOutage ? null : (globalMetrics?.cpu ?? null),
      memory: isOutage ? null : (globalMetrics?.memory ?? null),
      load: isOutage ? null : (globalMetrics?.load ?? null),
      bitbucket_cpu: null,
      jenkins_cpu: null,
      artifactory_cpu: null,
      nexusiq_cpu: null,
      teamcity_cpu: null,
      mcp_cpu: null,
      argocd_cpu: null,
      bitbucket_mem: null,
      jenkins_mem: null,
      artifactory_mem: null,
      nexusiq_mem: null,
      teamcity_mem: null,
      mcp_mem: null,
      argocd_mem: null
    };

    if (isOutage) return result;

    const appKeys = ['bitbucket', 'jenkins_k8s', 'artifactory', 'nexusiq', 'teamcity', 'mcp_server_k8s', 'argocd_k8s'];
    for (const appKey of appKeys) {
      const metricPrefix = appKey.replace('_k8s', '').replace('_server', '');
      const appConfig = appConfigs[appKey];
      if (!appConfig) continue;

      if (appConfig.servers) {
        const linuxServers = appConfig.servers.filter(s => s.type === 'linux');
        if (linuxServers.length > 0) {
          const promises = linuxServers.map(async (server) => {
            try {
              const controller = new AbortController();
              const id = setTimeout(() => controller.abort(), 1500);
              const res = await fetch(server.api, { signal: controller.signal });
              clearTimeout(id);
              if (res.ok) {
                const payload = await res.json();
                return payload.metrics || payload;
              }
            } catch (_) {}
            return null;
          });

          const results = await Promise.all(promises);
          const validResults = results.filter(r => r !== null);
          if (validResults.length > 0) {
            const sumCpu = validResults.reduce((acc, r) => acc + (typeof r.cpu === 'number' ? r.cpu : 0), 0);
            const sumMem = validResults.reduce((acc, r) => acc + (typeof r.memory === 'number' ? r.memory : 0), 0);
            result[`${metricPrefix}_cpu`] = parseFloat((sumCpu / validResults.length).toFixed(2));
            result[`${metricPrefix}_mem`] = parseFloat((sumMem / validResults.length).toFixed(2));
          }
        }
      } else if (appConfig.linux_api) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1500);
          const res = await fetch(appConfig.linux_api, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            const metrics = payload.metrics || payload;
            if (metrics.cpu !== undefined && metrics.cpu !== null) result[`${metricPrefix}_cpu`] = metrics.cpu;
            if (metrics.memory !== undefined && metrics.memory !== null) result[`${metricPrefix}_mem`] = metrics.memory;
          }
        } catch (_) {}
      }
    }

    return result;
  }
};
