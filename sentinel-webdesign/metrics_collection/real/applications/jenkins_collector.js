const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const { runSeleniumCheck } = require('../python_checks/runner');

/**
 * jenkins_collector.js (T2b.2 REMEDIATED)
 * 
 * CloudBees Jenkins CI/CD Controller Telemetry Collector.
 * Metrics parsed from live Jenkins API /api/json or null.
 * Response time measured directly via browser check or fetch latency. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.jenkins_master_url;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Jenkins URL not configured for PROD');
      return {
        executors: null,
        queue: null,
        responseTime: null,
        podsOnline: null,
        podsTotal: null
      };
    }

    // Perform active Selenium browser load latency check
    let browserCheck = { latency_ms: null, status: 'UNKNOWN' };
    try {
      browserCheck = await runSeleniumCheck(url);
    } catch (_) {}

    // Attempt live API fetch for build queue depth & executors
    const apiResult = await fetchJsonWithFallback(
      `${url}/api/json?tree=executors[currentExecutable[url]],queue[task[name]]`,
      { headers: { Accept: 'application/json' }, appId: 'cloudbees_jenkins' },
      3500
    );

    if (apiResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        executors: null,
        queue: null,
        responseTime: null,
        podsOnline: null,
        podsTotal: null
      };
    }

    const queue = apiResult.success && Array.isArray(apiResult.data?.queue)
      ? apiResult.data.queue.length
      : null;

    const executors = apiResult.success && Array.isArray(apiResult.data?.executors)
      ? apiResult.data.executors.length
      : null;

    const measuredLatency = browserCheck.latency_ms || apiResult.latencyMs || null;

    return {
      executors,
      queue,
      responseTime: measuredLatency,
      podsOnline: null,
      podsTotal: null
    };
  }
};
