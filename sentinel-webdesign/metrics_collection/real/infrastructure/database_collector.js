const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const { performance } = require('perf_hooks');

/**
 * database_collector.js (T2b.2 REMEDIATED)
 * 
 * Database Infrastructure & Connection Pool Telemetry Collector.
 * Every returned value is parsed from the database metrics API or is null.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const isOutage = simulations && simulations.database && simulations.database.type === 'outage';
    const isConnSpike = simulations && simulations.database && (simulations.database.type === 'connections' || simulations.database.type === 'pool_exhaustion');

    const dbEndpoint = targetConfig.database_api || targetConfig.infrastructure?.database?.api;
    let apiData = null;
    let fetchLatencyMs = null;

    if (dbEndpoint) {
      try {
        let dbSecret = null;
        try {
          dbSecret = await credentialProvider.getCredential('database', 'api');
        } catch (_) {}

        const headers = {};
        if (dbSecret) headers['Authorization'] = `Bearer ${dbSecret}`;

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const t0 = performance.now();
        const res = await fetch(dbEndpoint, { headers, signal: controller.signal });
        fetchLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          apiData = payload.metrics || payload;
        }
      } catch (_) {
        // DB API unreachable — all values stay null
      }
    }

    const result = {
      // Connection Pooling — from API or null
      database_status: apiData
        ? (isOutage ? 'CRITICAL - POOL STARVATION' : (isConnSpike ? 'WARNING - POOL QUEUEING' : 'HEALTHY'))
        : null,
      active_connections: apiData?.active_connections ?? null,
      idle_connections: apiData?.idle_connections ?? null,
      waiting_connection_requests: apiData?.waiting_connection_requests ?? null,
      max_connections_limit: apiData?.max_connections_limit ?? null,
      pool_saturation_pct: apiData?.pool_saturation_pct ?? null,
      connection_acquisition_latency_ms: apiData?.connection_acquisition_latency_ms ?? null,

      // Transaction Engine — from API or null
      transactions_committed_per_sec: apiData?.transactions_committed_per_sec ?? null,
      transactions_rolled_back_per_sec: apiData?.transactions_rolled_back_per_sec ?? null,
      buffer_cache_hit_ratio_pct: apiData?.buffer_cache_hit_ratio_pct ?? null,
      deadlock_conflicts_total: apiData?.deadlock_conflicts_total ?? null,
      longest_running_query_duration_sec: apiData?.longest_running_query_duration_sec ?? null,

      // Replication — from API or null
      replication_mode: apiData?.replication_mode ?? null,
      replication_standby_node: apiData?.replication_standby_node ?? null,
      replication_lag_bytes: apiData?.replication_lag_bytes ?? null,
      replication_replay_lag_seconds: apiData?.replication_replay_lag_seconds ?? null,
      replication_status: apiData?.replication_status ?? null,

      // Host Resources — from API or null
      cpu: apiData?.cpu ?? null,
      memory: apiData?.memory ?? null,
      transactions: apiData?.transactions ?? null,
      iops: apiData?.iops ?? null,

      _fetchLatencyMs: fetchLatencyMs
    };

    // Per-app DB metrics
    const dbApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.db || cfg.db_jdbc);

    const tasks = dbApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const appDbEndpoint = appConfig.layers?.db?.api || appConfig.db_jdbc;
      let appDbData = null;

      if (appDbEndpoint) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1200);
          const res = await fetch(appDbEndpoint, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            appDbData = payload.metrics || payload;
          }
        } catch (_) {}
      }

      result[`${metricPrefix}_connections`] = appDbData?.connections ?? null;
      result[`${metricPrefix}_tps`] = appDbData?.tps ?? null;
      result[`${metricPrefix}_dbLatency`] = appDbData?.dbLatency ?? null;
      result[`${metricPrefix}_pool_waiting`] = appDbData?.pool_waiting ?? null;
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
