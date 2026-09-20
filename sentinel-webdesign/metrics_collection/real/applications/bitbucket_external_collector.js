const config = require('@sentinel/config');
const { runSeleniumCheck } = require('../python_checks/runner');

/**
 * bitbucket_external_collector.js (T2b.2 REMEDIATED)
 * 
 * External Bitbucket Server Probe.
 * Real latency measured via browser check. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const url = targetConfig.bitbucket_external_api;

    if (!url) {
      return { responseTime: null, successRate: null, requests: null };
    }

    let browserCheck = { latency_ms: null, login_success: null };
    try {
      browserCheck = await runSeleniumCheck(url);
    } catch (_) {}

    let successRate = null;
    if (browserCheck.login_success !== null && browserCheck.login_success !== undefined) {
      successRate = browserCheck.login_success ? 100.0 : 0.0;
    }

    return {
      responseTime: browserCheck.latency_ms || null,
      successRate,
      requests: null
    };
  }
};
