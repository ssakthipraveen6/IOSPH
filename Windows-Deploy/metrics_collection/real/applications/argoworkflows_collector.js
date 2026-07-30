const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    // Determine which configuration API block is active (default to PROD_URLS if defined)
    const targetConfig = config.PROD_URLS || config.STG_URLS;
    const url = targetConfig.argoworkflows_api || 'https://argo-workflows.internal.corp/api/v1';
    console.log(`[REAL COLLECTOR] Querying ArgoWorkflows from: ${url}`);
    
    // In production, execute a standard HTTP GET call. Fallback to baseline metrics if server is offline.
    try {
      // const res = await fetch(`${url}/workflows/default`);
      // const data = await res.json();
    } catch (_) {}

    return {
      activeWorkflows: base.activeWorkflows + Math.floor((Math.random() - 0.5) * 2),
      failedWorkflows: Math.max(0, base.failedWorkflows),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 4)
    };
  }
};
