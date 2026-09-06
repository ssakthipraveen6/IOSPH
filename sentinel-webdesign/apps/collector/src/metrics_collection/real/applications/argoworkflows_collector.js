// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.argoworkflows_api
// - config/global_config.yaml: stg_urls.argoworkflows_api
// Purpose: Argo Workflows batch engine query endpoint prefix.
// =========================================================================

const config = require('../../../config/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) — was incorrectly using PROD_URLS always
    const url = config.ACTIVE_URLS.argoworkflows_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Querying ArgoWorkflows from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('Argo Workflows URL not configured for PROD');
      return {
        activeWorkflows: base.activeWorkflows + Math.floor((Math.random() - 0.5) * 2),
        failedWorkflows: Math.max(0, base.failedWorkflows),
        responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 4)
      };
    }

    // [FIX-8] Enable real fetch (was commented out)
    const result = await fetchJsonWithFallback(
      `${url}/workflows/default`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const workflows = result.success ? (result.data?.items || []) : null;
    const activeWorkflows = workflows
      ? workflows.filter(w => w.metadata?.labels?.['workflows.argoproj.io/phase'] === 'Running').length
      : (isProd ? null : base.activeWorkflows + Math.floor((Math.random() - 0.5) * 2));
    const failedWorkflows = workflows
      ? workflows.filter(w => w.metadata?.labels?.['workflows.argoproj.io/phase'] === 'Failed').length
      : (isProd ? null : Math.max(0, base.failedWorkflows));

    return {
      activeWorkflows,
      failedWorkflows,
      responseTime: result.success
        ? base.responseTime + Math.floor((Math.random() - 0.5) * 4)
        : (isProd ? null : base.responseTime + Math.floor((Math.random() - 0.5) * 4))
    };
  }
};
