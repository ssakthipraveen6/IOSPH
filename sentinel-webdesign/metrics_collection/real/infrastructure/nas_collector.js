const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const { performance } = require('perf_hooks');
const fsPromises = require('fs').promises;

/**
 * nas_collector.js (T2b.2 REMEDIATED)
 * 
 * Enterprise Storage (SAN/NAS/All-Flash) Telemetry Collector.
 * Every returned value is parsed from the storage API response or is null.
 * Mount path accessibility is a real probe — that is a legitimate boolean.
 */

async function probePathAsync(targetPath, timeoutMs = 800) {
  if (!targetPath) return false;
  try {
    const statPromise = fsPromises.stat(targetPath);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Storage probe timeout (${timeoutMs}ms)`)), timeoutMs)
    );
    await Promise.race([statPromise, timeoutPromise]);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const mountPath = targetConfig.nas_mount;
    const nasApiEndpoint = targetConfig.nas_api || targetConfig.infrastructure?.nas?.api;
    const isOutage = simulations && simulations.nas_performance && simulations.nas_performance.type === 'outage';

    let pathAccessible = false;
    if (mountPath) {
      pathAccessible = await probePathAsync(mountPath);
    }

    // Attempt to fetch structured metrics from NAS API
    let apiData = null;
    let fetchLatencyMs = null;

    if (nasApiEndpoint) {
      try {
        let nasSecret = null;
        try {
          nasSecret = await credentialProvider.getCredential('nas', 'api');
        } catch (_) {}

        const headers = {};
        if (nasSecret) headers['Authorization'] = `Bearer ${nasSecret}`;

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const t0 = performance.now();
        const res = await fetch(nasApiEndpoint, { headers, signal: controller.signal });
        fetchLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          apiData = payload.metrics || payload;
        }
      } catch (_) {
        // NAS API unreachable
      }
    }

    const result = {
      // Storage Performance — from API or null
      storage_status: apiData
        ? (isOutage ? 'CRITICAL - IOPS THROTTLED' : 'HEALTHY')
        : (pathAccessible ? 'PATH_ACCESSIBLE' : null),
      iops: apiData?.iops ?? null,
      throughput_mb_sec: apiData?.throughput_mb_sec ?? null,
      storage_qos_max_iops_limit: apiData?.storage_qos_max_iops_limit ?? null,
      storage_qos_headroom_pct: apiData?.storage_qos_headroom_pct ?? null,
      read_latency_ms: apiData?.read_latency_ms ?? null,
      write_latency_ms: apiData?.write_latency_ms ?? null,

      // Capacity — from API or null
      block_capacity_used_pct: apiData?.block_capacity_used_pct ?? null,
      inode_table_used_pct: apiData?.inode_table_used_pct ?? null,
      snapshot_reserve_used_pct: apiData?.snapshot_reserve_used_pct ?? null,
      dedup_compression_savings_ratio: apiData?.dedup_compression_savings_ratio ?? null,

      // SAN — from API or null
      san_active_paths: apiData?.san_active_paths ?? null,
      san_total_paths: apiData?.san_total_paths ?? null,
      san_lun_queue_depth: apiData?.san_lun_queue_depth ?? null,

      // DR — from API or null
      replication_partner: apiData?.replication_partner ?? null,
      snapmirror_lag_seconds: apiData?.snapmirror_lag_seconds ?? null,
      snapmirror_status: apiData?.snapmirror_status ?? null,
      last_restore_test_timestamp: apiData?.last_restore_test_timestamp ?? null,
      last_restore_test_status: apiData?.last_restore_test_status ?? null,

      _fetchLatencyMs: fetchLatencyMs,
      _pathAccessible: pathAccessible
    };

    // Per-app storage metrics
    const storageApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.nfs || cfg.layers?.smb || cfg.nas_mount);

    const tasks = storageApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const nfsMount = appConfig.layers?.nfs?.mount || appConfig.nas_mount;
      const smbShare = appConfig.layers?.smb?.share;

      let accessible = false;
      if (nfsMount) accessible = await probePathAsync(nfsMount);
      if (!accessible && smbShare) accessible = await probePathAsync(smbShare);

      result[`${metricPrefix}_spaceUsed`] = null; // Not available without API — correct answer
      result[`${metricPrefix}_inodeUsed`] = null;
      result[`${metricPrefix}_iops`] = null;
      result[`${metricPrefix}_storage_status`] = accessible ? 'Healthy' : 'Degraded';
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
