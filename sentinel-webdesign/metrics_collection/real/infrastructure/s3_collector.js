const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const { performance } = require('perf_hooks');

/**
 * s3_collector.js (T2b.2 REMEDIATED)
 * 
 * Object Storage / S3 Telemetry Collector.
 * Real latency measured via performance.now() on probe requests.
 * All metrics parsed from target endpoint or null. Zero Math.random().
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.s3_endpoint;
    const isOutage = simulations && simulations.s3_storage && simulations.s3_storage.type === 'outage';

    let measuredLatency = null;
    let endpointReachable = false;

    if (url && !isOutage) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const t0 = performance.now();
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        measuredLatency = parseFloat((performance.now() - t0).toFixed(2));
        clearTimeout(id);
        endpointReachable = res.ok || res.status === 403; // 403 means reachable/auth challenge
      } catch (e) {
        measuredLatency = null;
      }
    }

    const result = {
      latency: isOutage ? null : measuredLatency,
      space: null, // S3 HEAD does not expose bucket size without CloudWatch API
      bandwidth: null
    };

    // Dynamically query S3 layers for configured applications
    const s3Apps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.s3 || cfg.s3_endpoint);

    const tasks = s3Apps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const s3Url = appConfig.layers?.s3?.endpoint || appConfig.s3_endpoint;
      const purpose = appConfig.layers?.s3?.credential_purpose;

      if (purpose) {
        try {
          await credentialProvider.getCredential(appKey, purpose);
        } catch (_) {}
      }

      let appLatency = null;
      if (s3Url && !isOutage) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1500);
          const t0 = performance.now();
          const res = await fetch(s3Url, { method: 'HEAD', signal: controller.signal });
          appLatency = parseFloat((performance.now() - t0).toFixed(2));
          clearTimeout(id);
        } catch (_) {}
      }

      result[`${metricPrefix}_space`] = null;
      result[`${metricPrefix}_bandwidth`] = null;
      result[`${metricPrefix}_latency`] = appLatency;
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
