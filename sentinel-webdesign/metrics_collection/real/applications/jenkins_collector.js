// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/global_config.yaml.
// Update the actual production/staging endpoints at:
// - config/global_config.yaml: prod_urls.jenkins_master_url
// - config/global_config.yaml: stg_urls.jenkins_master_url
// Purpose: CloudBees Jenkins Master / CJOC server URL.
// =========================================================================

const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const { runSeleniumCheck } = require('../python_checks/runner');

module.exports = {
  collect: async (simulations, base) => {
    // [FIX-2] Use ACTIVE_URLS (dynamic getter) instead of hardcoded STG_URLS
    const url = config.ACTIVE_URLS.jenkins_master_url;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    console.log(`[REAL COLLECTOR] Fetching Jenkins builds queue from: ${url}`);

    if (!url) {
      if (isProd) throw new Error('Jenkins URL not configured for PROD');
      return {
        executors: base.executors,
        queue: base.queue,
        responseTime: base.responseTime
      };
    }

    // Perform active Selenium browser load latency check
    const browserCheck = await runSeleniumCheck(url);

    // Attempt live API fetch for build queue depth
    const apiResult = await fetchJsonWithFallback(
      `${url}/api/json?tree=executors[currentExecutable[url]],queue[task[name]]`,
      { headers: { Accept: 'application/json' } },
      3500
    );

    const queue = apiResult.success && apiResult.data?.queue
      ? apiResult.data.queue.length
      : (isProd ? null : Math.max(0, base.queue + Math.floor((Math.random() - 0.5) * 2)));

    const executors = apiResult.success && apiResult.data?.executors
      ? apiResult.data.executors.length
      : (isProd ? null : base.executors);

    return {
      executors,
      queue,
      responseTime: browserCheck.latency_ms || (isProd ? null : base.responseTime),
      podsOnline: base.podsOnline,
      podsTotal: base.podsTotal
    };
  }
};
