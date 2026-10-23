/**
 * Collects CloudBees Jenkins metrics and polls the declared operations centres and controllers.
 */
const config = require('@sentinel/config');
const { fetchJsonWithFallback } = require('../../shared/fetch_with_fallback');
const yamlConfig = require('@sentinel/config/yaml_config');
const topologyPoller = require('./jenkins_topology');
const { updateProductVersion } = require('../../shared/version_tracker');

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

    // The browser-load check no longer runs in this cycle (it blocks for seconds per call).
    // Page-load and SSO-login timing belong to the synthetic probes.

    // Per-controller polling when the manifest declares operations centres and controllers.
    let topology = null;
    try {
      const manifest = yamlConfig.getApplication('cloudbees_jenkins');
      topology = manifest && manifest.topology;
    } catch (_) { topology = null; }
    if (topologyPoller.listControllers(topology).length > 0) {
      const snap = await topologyPoller.pollAll(topology, { fetchJson: fetchJsonWithFallback });
      topologyPoller.setLastSnapshot(snap);
      try {
        const agents = snap.controllers.flatMap(c => c.computers.map(x => ({ displayName: x.name, offline: x.offline, numExecutors: x.num_executors, region: x.region })));
        if (agents.length) await require('@sentinel/inventory').sources.jenkins.syncJenkinsInventory({ computers: agents });
      } catch (_) { /* inventory is best-effort here */ }
      if (snap.answered === 0 && snap.auth_failed > 0) {
        return { status: 'AUTH_FAILED', error: 'AUTH_FAILED', authFailed: true, executors: null, queue: null, responseTime: null, podsOnline: null, podsTotal: null };
      }
      if (snap.answered > 0) {
        const lat = snap.controllers.map(c => c.latency_ms).filter(Number.isFinite);
        return {
          executors: snap.totals.executors_total,
          busyExecutors: snap.totals.executors_busy,
          queue: snap.totals.queue,
          controllersAnswered: snap.answered,
          controllersDeclared: snap.declared,
          responseTime: lat.length ? Math.max(...lat) : null,
          podsOnline: null,
          podsTotal: null
        };
      }
      // No controller answered: fall through to the single-URL call below.
    }

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

    // Capture product version from X-Jenkins response header or API data
    try {
      const version = apiResult.headers?.['x-jenkins'] || apiResult.data?.version || null;
      if (version) {
        const env = (global.runtimeEnvironment || config.ENVIRONMENT || 'staging').toLowerCase();
        await updateProductVersion('jenkins', String(version), env, 'product_api');
      }
    } catch (_) {}

    const queue = apiResult.success && Array.isArray(apiResult.data?.queue)
      ? apiResult.data.queue.length
      : null;

    const executors = apiResult.success && Array.isArray(apiResult.data?.executors)
      ? apiResult.data.executors.length
      : null;

    const measuredLatency = apiResult.latencyMs || null;

    return {
      executors,
      queue,
      responseTime: measuredLatency,
      podsOnline: null,
      podsTotal: null
    };
  }
};
