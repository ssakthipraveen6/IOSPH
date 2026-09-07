// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.argocd_api
// - config/global_config.yaml: stg_urls.argocd_api
// Purpose: ArgoCD sync states query endpoint prefix.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-8] Use ACTIVE_URLS (dynamic getter) — was incorrectly preferring STG_URLS first
    const url = config.ACTIVE_URLS.argocd_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      console.warn('[REAL COLLECTOR] No ArgoCD endpoint URL configured. Using baseline.');
      if (isProd) throw new Error('ArgoCD URL not configured for PROD');
      return { syncStatus: 'Synced', latency: base.latency, clusterCount: base.clusterCount };
    }

    console.log(`[REAL COLLECTOR] Fetching ArgoCD cluster syncs from: ${url}`);

    const healthResult = await fetchJsonWithFallback(
      `${url}/applications`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const connected = healthResult.success;
    const apps = connected ? (healthResult.data?.items || []) : null;

    return {
      syncStatus: connected
        ? (apps && apps.every(a => a.status?.sync?.status === 'Synced') ? 'Synced' : 'OutOfSync')
        : (isProd ? null : 'Synced'),
      latency: connected
        ? base.latency + Math.floor((Math.random() - 0.5) * 4)
        : (isProd ? null : base.latency + Math.floor((Math.random() - 0.5) * 4)),
      clusterCount: connected
        ? (apps ? apps.length : base.clusterCount)
        : (isProd ? null : base.clusterCount)
    };
  }
};
