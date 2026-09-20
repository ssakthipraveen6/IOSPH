const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * argoworkflows_collector.js (T2b.2 REMEDIATED)
 * 
 * Argo Workflows Engine Telemetry Collector.
 * Metrics parsed from /workflows/default or null.
 * Response time measured from real fetch latency. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.argoworkflows_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Argo Workflows URL not configured for PROD');
      return {
        activeWorkflows: null,
        failedWorkflows: null,
        responseTime: null
      };
    }

    const result = await fetchJsonWithFallback(
      `${url}/workflows/default`,
      { headers: { Accept: 'application/json' }, appId: 'argoworkflows' },
      3500
    );

    if (result.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        activeWorkflows: null,
        failedWorkflows: null,
        responseTime: null
      };
    }

    if (!result.success) {
      return {
        activeWorkflows: null,
        failedWorkflows: null,
        responseTime: null
      };
    }

    const workflows = Array.isArray(result.data?.items) ? result.data.items : [];
    const activeWorkflows = workflows.filter(w => w.metadata?.labels?.['workflows.argoproj.io/phase'] === 'Running').length;
    const failedWorkflows = workflows.filter(w => w.metadata?.labels?.['workflows.argoproj.io/phase'] === 'Failed').length;

    return {
      activeWorkflows,
      failedWorkflows,
      responseTime: result.latencyMs || null
    };
  }
};
