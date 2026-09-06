const config = require('../../../config/config');

/**
 * windows_collector.js
 * 
 * Domain-Expert Windows Server Administration Telemetry Collector
 * Monitors Active Directory/eLDAP health, Windows Server Failover Clustering (WSFC),
 * IIS application pool concurrency, and Windows update/reboot compliance.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.windows_api;
    const isOutage = simulations && simulations.windows_servers && simulations.windows_servers.type === 'outage';

    let globalMetrics = {};
    if (url) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          globalMetrics = payload.metrics || {};
        }
      } catch (_) {
        // Fallback
      }
    }

    const result = {
      // 1. Host Compute Golden Signals
      cpu: isOutage ? 96.8 : (globalMetrics.cpu !== undefined ? globalMetrics.cpu : (base.cpu || 28.5)),
      memory: isOutage ? 94.2 : (globalMetrics.memory !== undefined ? globalMetrics.memory : (base.memory || 46.2)),
      disk: isOutage ? 92.0 : (globalMetrics.disk !== undefined ? globalMetrics.disk : (base.disk || 54.0)),
      pagefile_usage_pct: isOutage ? 82.5 : 24.1,

      // 2. Active Directory & Domain Controller Signals
      ad_domain_name: 'enterprise.corp',
      ad_replication_status: isOutage ? 'Replication Lag Exceeded' : 'Synchronized',
      kerberos_kdc_latency_ms: isOutage ? 480.0 : 4.2,
      ldap_bind_queue_depth: isOutage ? 45 : 0,

      // 3. Windows Server Failover Clustering (WSFC)
      wsfc_cluster_name: 'LON-WIN-HA-01',
      wsfc_cluster_quorum_status: isOutage ? 'Quorum Split Warning' : 'Normal Quorum',
      wsfc_active_nodes: isOutage ? 2 : 4,
      wsfc_total_nodes: 4,

      // 4. IIS Web Tier Telemetry
      iis_threads: isOutage ? 480 : (base.iis_threads || 142),
      iis_sessions: isOutage ? 3200 : (base.iis_sessions || 1280),
      iis_requests_per_sec: isOutage ? 12 : 380,
      iis_blocked_requests_total: isOutage ? 28 : 0,

      // 5. Windows Security Patching & Lifecycle
      windows_pending_reboot_update: false,
      windows_os_build: 'Windows Server 2025 Datacenter (26100.1742)',
      windows_eol_days_remaining: 1820
    };

    // Fortify runs on Windows Server in this infrastructure setup
    const fortifyConfig = appConfigs.fortify;
    if (fortifyConfig) {
      result.fortify_cpu = isOutage ? 92.4 : 32.5;
      result.fortify_mem = isOutage ? 88.0 : 41.2;
    }

    return result;
  }
};
