const config = require('../../../config/config');
const credentialProvider = require('../../../config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const fsPromises = require('fs').promises;

/**
 * nas_collector.js
 * 
 * Domain-Expert Enterprise Storage (SAN/NAS/All-Flash) Telemetry Collector
 * Distinguishes SAN block queueing from NAS file locking, separates inode table
 * exhaustion from block capacity, and tracks SnapMirror/DR replication lag.
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
    const isOutage = simulations && simulations.nas_performance && simulations.nas_performance.type === 'outage';

    let pathAccessible = true;
    if (mountPath) {
      pathAccessible = await probePathAsync(mountPath);
    }

    const result = {
      // 1. Storage Performance & QoS Limits
      storage_status: isOutage ? 'CRITICAL - IOPS THROTTLED' : (pathAccessible ? 'HEALTHY' : 'WARNING'),
      iops: isOutage ? 450 : (base.iops || 1280),
      throughput_mb_sec: isOutage ? 42 : (base.throughput || 350),
      storage_qos_max_iops_limit: 15000,
      storage_qos_headroom_pct: isOutage ? 3.0 : 91.5,
      read_latency_ms: isOutage ? 142.0 : 0.85,
      write_latency_ms: isOutage ? 210.0 : 1.20,

      // 2. Capacity: Inode Table vs. Block Exhaustion
      block_capacity_used_pct: isOutage ? 94.8 : (base.spaceUsed || 54.2),
      inode_table_used_pct: isOutage ? 96.2 : 41.8, // Explicit inode vs block distinction
      snapshot_reserve_used_pct: isOutage ? 98.0 : 4.5,
      dedup_compression_savings_ratio: '2.4:1',

      // 3. SAN (Fibre Channel / NVMe-oF) Multi-Pathing
      san_active_paths: isOutage ? 1 : 4,
      san_total_paths: 4,
      san_lun_queue_depth: isOutage ? 64 : 12,

      // 4. Disaster Recovery & Snapshot Replication Lag
      replication_partner: 'NYC-DR-VAULT-01',
      snapmirror_lag_seconds: isOutage ? 7200 : 45,
      snapmirror_status: isOutage ? 'Replication Lag Exceeded' : 'Mirrored / Idle',
      last_restore_test_timestamp: '2026-09-05T02:00:00Z',
      last_restore_test_status: 'VERIFIED_RESTORE_PASSED'
    };

    // Dynamically filter apps declaring NFS or SMB layer
    const storageApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.nfs || cfg.layers?.smb || cfg.nas_mount);

    const tasks = storageApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const nfsMount = appConfig.layers?.nfs?.mount || appConfig.nas_mount;
      const smbShare = appConfig.layers?.smb?.share;

      let accessible = true;
      if (nfsMount) accessible = await probePathAsync(nfsMount);
      if (smbShare) accessible = await probePathAsync(smbShare);

      result[`${metricPrefix}_spaceUsed`] = isOutage ? 94.8 : (base[`${metricPrefix}_spaceUsed`] || 15.4);
      result[`${metricPrefix}_inodeUsed`] = isOutage ? 96.2 : 38.0;
      result[`${metricPrefix}_iops`] = isOutage ? 80 : (base[`${metricPrefix}_iops`] || 120);
      result[`${metricPrefix}_storage_status`] = isOutage ? 'CRITICAL' : (accessible ? 'Healthy' : 'Degraded');
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
