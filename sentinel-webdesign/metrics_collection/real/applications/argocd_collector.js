const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * argocd_collector.js (T2b.2 REMEDIATED)
 * 
 * ArgoCD GitOps Continuous Delivery Telemetry Collector.
 * Metrics parsed from live /applications endpoint or null.
 * Real latency measured via performance timer. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.argocd_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('ArgoCD URL not configured for PROD');
      return { syncStatus: null, latency: null, clusterCount: null };
    }

    const healthResult = await fetchJsonWithFallback(
      `${url}/applications`,
      { headers: { Accept: 'application/json' }, appId: 'argocd' },
      3500
    );

    if (healthResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        syncStatus: null,
        latency: null,
        clusterCount: null
      };
    }

    if (!healthResult.success) {
      return {
        syncStatus: null,
        latency: null,
        clusterCount: null
      };
    }

    const apps = Array.isArray(healthResult.data?.items) ? healthResult.data.items : [];
    const syncStatus = apps.length > 0 && apps.every(a => a.status?.sync?.status === 'Synced') ? 'Synced' : (apps.length > 0 ? 'OutOfSync' : 'Unknown');

    return {
      syncStatus,
      latency: healthResult.latencyMs || null,
      clusterCount: apps.length
    };
  }
};
