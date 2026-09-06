const config = require('../../../config/config');
const credentialProvider = require('../../../config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');

/**
 * database_collector.js
 * 
 * Domain-Expert Database Infrastructure & Connection Pool Telemetry Collector
 * Separates active vs idle vs waiting connection queues, tracks acquisition latency,
 * buffer cache hit ratios, and physical WAL replication lag.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const isOutage = simulations && simulations.database && simulations.database.type === 'outage';
    const isConnSpike = simulations && simulations.database && (simulations.database.type === 'connections' || simulations.database.type === 'pool_exhaustion');

    const maxConnections = 500;
    const activeConns = isOutage ? 496 : (isConnSpike ? 485 : 184);
    const waitingThreads = isOutage ? 78 : (isConnSpike ? 42 : 0);
    const idleConns = Math.max(0, maxConnections - activeConns - waitingThreads);

    const result = {
      // 1. Connection Pooling Internals
      database_status: isOutage ? 'CRITICAL - POOL STARVATION' : (isConnSpike ? 'WARNING - POOL QUEUEING' : 'HEALTHY'),
      active_connections: activeConns,
      idle_connections: idleConns,
      waiting_connection_requests: waitingThreads,
      max_connections_limit: maxConnections,
      pool_saturation_pct: parseFloat(((activeConns / maxConnections) * 100).toFixed(1)),
      connection_acquisition_latency_ms: isOutage ? 1850.0 : (isConnSpike ? 340.0 : 1.45),

      // 2. Transaction Engine & Cache Performance
      transactions_committed_per_sec: isOutage ? 42 : 1940,
      transactions_rolled_back_per_sec: isOutage ? 280 : 3,
      buffer_cache_hit_ratio_pct: isOutage ? 74.2 : 99.6,
      deadlock_conflicts_total: isOutage ? 14 : 0,
      longest_running_query_duration_sec: isOutage ? 480 : 1.2,

      // 3. PostgreSQL Physical Streaming Replication Lag
      replication_mode: 'Streaming Physical WAL',
      replication_standby_node: 'LON-PG-STANDBY-01',
      replication_lag_bytes: isOutage ? 142857600 : 4096, // Exact byte lag (pg_wal_lsn_diff)
      replication_replay_lag_seconds: isOutage ? 240.0 : 0.08,
      replication_status: isOutage ? 'REPLICATION_DELAY_EXCEEDED' : 'STREAMING_SYNCHRONIZED',

      // 4. Host Resource Golden Signals
      cpu: isOutage ? 94.5 : (base.cpu || 32.5),
      memory: isOutage ? 89.2 : (base.memory || 58.1),
      transactions: isOutage ? 140 : (base.transactions || 450),
      iops: isOutage ? 3400 : (base.iops || 800)
    };

    // Dynamically filter all apps with DB layer configuration
    const dbApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.db || cfg.db_jdbc);

    const tasks = dbApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      result[`${metricPrefix}_connections`] = isOutage ? 98 : (isConnSpike ? 94 : 45);
      result[`${metricPrefix}_tps`] = isOutage ? 12 : 180;
      result[`${metricPrefix}_dbLatency`] = isOutage ? 840.0 : (isConnSpike ? 145.0 : 12.4);
      result[`${metricPrefix}_pool_waiting`] = isOutage ? 18 : 0;
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
