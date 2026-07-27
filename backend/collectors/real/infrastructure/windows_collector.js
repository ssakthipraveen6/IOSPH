const config = require('../../../config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.windows_api;
    console.log(`[REAL COLLECTOR] Fetching Windows host metrics from: ${url}`);
    
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
      console.warn(`[REAL COLLECTOR] Failed fetching Windows host API: ${e.message}. Using baseline.`);
    }

    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 4).toFixed(2)),
      memory: parseFloat((base.memory + (Math.random() - 0.5) * 2).toFixed(2)),
      disk: base.disk,
      fortify_cpu: base.fortify_cpu,
      fortify_mem: base.fortify_mem,
      iis_threads: base.iis_threads,
      iis_sessions: base.iis_sessions
    };
  }
};
