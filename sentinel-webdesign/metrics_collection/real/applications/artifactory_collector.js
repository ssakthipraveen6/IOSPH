const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const { runSeleniumCheck } = require('../python_checks/runner');

/**
 * artifactory_collector.js (T2b.2 REMEDIATED)
 * 
 * JFrog Artifactory Storage & Artifact Repository Telemetry Collector.
 * Metrics parsed from live Artifactory storageinfo API or null.
 * Latency measured via real browser check or fetch timer. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.artifactory_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('Artifactory URL not configured for PROD');
      return { heap: null, space: null, latency: null };
    }

    // Perform active Selenium browser load latency check
    let browserCheck = { latency_ms: null, status: 'UNKNOWN' };
    try {
      browserCheck = await runSeleniumCheck(url);
    } catch (_) {}

    // Attempt live storage check
    const storageResult = await fetchJsonWithFallback(
      `${url}/storageinfo`,
      { headers: { Accept: 'application/json' }, appId: 'jfrog_artifactory' },
      3500
    );

    if (storageResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        heap: null,
        space: null,
        latency: null
      };
    }

    let space = null;
    if (storageResult.success && storageResult.data?.storageSummary) {
      const binaries = storageResult.data.storageSummary.binariesSummary;
      if (binaries && binaries.usedSpace) {
        space = typeof binaries.usedSpace === 'number' ? binaries.usedSpace : parseFloat(binaries.usedSpace);
      }
    }

    const measuredLatency = browserCheck.latency_ms || storageResult.latencyMs || null;

    return {
      heap: null, // Not exposed on /storageinfo
      space,
      latency: measuredLatency
    };
  }
};
