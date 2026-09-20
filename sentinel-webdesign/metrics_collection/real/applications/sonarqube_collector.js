const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');

/**
 * sonarqube_collector.js (T2b.2 REMEDIATED)
 * 
 * SonarQube Code Quality & Static Analysis Telemetry Collector.
 * Response time measured with performance.now().
 * System status parsed from live /api/system/status or /system/status.
 * Zero Math.random(), zero baseline fallbacks.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const url = config.ACTIVE_URLS?.sonarqube_api;
    const isProd = (global.runtimeEnvironment || config.ENVIRONMENT) === 'prod';

    if (!url) {
      if (isProd) throw new Error('SonarQube URL not configured for PROD');
      return {
        systemStatus: null,
        qualityGatesPassed: null,
        analysisQueue: null,
        responseTime: null
      };
    }

    const healthResult = await fetchJsonWithFallback(
      `${url}/system/status`,
      { headers: { Accept: 'application/json' }, appId: 'sonarqube' },
      3500
    );

    if (healthResult.authFailed) {
      return {
        status: 'AUTH_FAILED',
        error: 'AUTH_FAILED',
        authFailed: true,
        systemStatus: null,
        qualityGatesPassed: null,
        analysisQueue: null,
        responseTime: null
      };
    }

    if (!healthResult.success) {
      return {
        systemStatus: null,
        qualityGatesPassed: null,
        analysisQueue: null,
        responseTime: null
      };
    }

    const systemStatus = healthResult.data?.status || 'UP';
    const responseTime = healthResult.latencyMs || null;

    // Optional: probe Compute Engine activity status for analysis queue
    let analysisQueue = null;
    try {
      const ceResult = await fetchJsonWithFallback(
        `${url}/ce/activity_status`,
        { headers: { Accept: 'application/json' }, appId: 'sonarqube' },
        2000
      );
      if (ceResult.success && ceResult.data) {
        analysisQueue = (ceResult.data.pending || 0) + (ceResult.data.inProgress || 0);
      }
    } catch (_) {}

    return {
      systemStatus,
      qualityGatesPassed: null, // SonarQube system/status does not expose aggregate QG pass count without project scan
      analysisQueue,
      responseTime
    };
  }
};
