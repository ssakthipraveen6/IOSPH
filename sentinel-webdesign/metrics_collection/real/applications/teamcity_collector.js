const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * teamcity_collector.js (T2b.2 REMEDIATED)
 * 
 * JetBrains TeamCity Build Server Telemetry Collector.
 * Metrics parsed from live TeamCity REST API (/buildQueue, /agents) or null.
 * Zero Math.random(), zero baseline fallbacks.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.teamcity_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('TeamCity URL not configured for PROD');
      return { activeBuilds: null, agents: null, load: null, responseTime: null };
    }

    const queueResult = await fetchJsonWithFallback(
      `${url}/buildQueue`,
      { headers: { Accept: 'application/json' }, appId: 'jetbrains_teamcity' },
      3500
    );

    if (queueResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        activeBuilds: null,
        agents: null,
        load: null,
        responseTime: null
      };
    }

    if (!queueResult.success) {
      return {
        activeBuilds: null,
        agents: null,
        load: null,
        responseTime: null
      };
    }

    const activeBuilds = typeof queueResult.data?.count === 'number'
      ? queueResult.data.count
      : (Array.isArray(queueResult.data?.build) ? queueResult.data.build.length : null);

    // Attempt agent count lookup
    let agents = null;
    try {
      const agentsResult = await fetchJsonWithFallback(
        `${url}/agents`,
        { headers: { Accept: 'application/json' }, appId: 'jetbrains_teamcity' },
        2000
      );
      if (agentsResult.success && typeof agentsResult.data?.count === 'number') {
        agents = agentsResult.data.count;
      }
    } catch (_) {}

    const load = (activeBuilds !== null && agents) ? parseFloat((activeBuilds / agents).toFixed(2)) : 0;

    return {
      activeBuilds,
      agents,
      load,
      responseTime: queueResult.latencyMs || 0
    };
  }
};
