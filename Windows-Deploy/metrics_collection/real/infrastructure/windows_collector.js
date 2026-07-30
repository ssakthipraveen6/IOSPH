const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.STG_URLS || config.PROD_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.windows_api;
    console.log(`[REAL COLLECTOR] Fetching Windows host metrics from: ${url}`);
    
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
      console.warn(`[REAL COLLECTOR] Failed fetching Windows host API: ${e.message}. Using baseline.`);
    }

    const result = {
      cpu: globalMetrics.cpu !== undefined ? globalMetrics.cpu : parseFloat((base.cpu + (Math.random() - 0.5) * 4).toFixed(2)),
      memory: globalMetrics.memory !== undefined ? globalMetrics.memory : parseFloat((base.memory + (Math.random() - 0.5) * 2).toFixed(2)),
      disk: globalMetrics.disk !== undefined ? globalMetrics.disk : base.disk,
      fortify_cpu: base.fortify_cpu,
      fortify_mem: base.fortify_mem,
      iis_threads: base.iis_threads,
      iis_sessions: base.iis_sessions
    };

    // Fortify runs on Windows Server in this infrastructure setup
    const fortifyConfig = appConfigs.fortify;
    if (fortifyConfig) {
      if (fortifyConfig.servers) {
        const winServers = fortifyConfig.servers.filter(s => s.type === 'windows');
        if (winServers.length > 0) {
          const promises = winServers.map(async (server) => {
            console.log(`[REAL COLLECTOR] Fetching Windows host metrics for fortify node ${server.node} from: ${server.api}`);
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
              console.warn(`[REAL COLLECTOR] Failed fetching Windows host API for fortify node ${server.node}: ${e.message}`);
            }
            return null;
          });

          const results = await Promise.all(promises);
          const validResults = results.filter(r => r !== null);
          if (validResults.length > 0) {
            const sumCpu = validResults.reduce((acc, r) => acc + (r.cpu !== undefined ? r.cpu : 0), 0);
            const sumMem = validResults.reduce((acc, r) => acc + (r.memory !== undefined ? r.memory : 0), 0);
            result.fortify_cpu = parseFloat((sumCpu / validResults.length).toFixed(2));
            result.fortify_mem = parseFloat((sumMem / validResults.length).toFixed(2));
          }
        }
      } else if (fortifyConfig.windows_api) {
        console.log(`[REAL COLLECTOR] Fetching Windows host metrics for fortify from: ${fortifyConfig.windows_api}`);
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1500);
          const res = await fetch(fortifyConfig.windows_api, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            const metrics = payload.metrics || {};
            if (metrics.cpu !== undefined) result.fortify_cpu = metrics.cpu;
            if (metrics.memory !== undefined) result.fortify_mem = metrics.memory;
          }
        } catch (e) {
          console.warn(`[REAL COLLECTOR] Failed fetching Windows host API for fortify: ${e.message}`);
        }
      }
    }

    return result;
  }
};
