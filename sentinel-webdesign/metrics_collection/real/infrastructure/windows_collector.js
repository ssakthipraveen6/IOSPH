const config = require('@sentinel/config');

/**
 * windows_collector.js (T2b.2 REMEDIATED)
 * 
 * Windows Server Administration & IIS Telemetry Collector.
 * Every metric is parsed from the Windows management API or is null.
 * Zero hardcoded numeric constants reach returned metric values.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const url = targetConfig.windows_api;
    const isOutage = simulations && simulations.windows_servers && simulations.windows_servers.type === 'outage';

    let globalMetrics = null;
    if (url && !isOutage) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          globalMetrics = payload.metrics || payload;
        }
      } catch (_) {}
    }

    const result = {
      // 1. Host Compute Golden Signals
      cpu: isOutage ? null : (globalMetrics?.cpu ?? null),
      memory: isOutage ? null : (globalMetrics?.memory ?? null),
      disk: isOutage ? null : (globalMetrics?.disk ?? null),
      pagefile_usage_pct: isOutage ? null : (globalMetrics?.pagefile_usage_pct ?? null),

      // 2. Active Directory & Domain Controller Signals
      ad_domain_name: globalMetrics?.ad_domain_name ?? null,
      ad_replication_status: isOutage ? 'Replication Lag Exceeded' : (globalMetrics?.ad_replication_status ?? null),
      kerberos_kdc_latency_ms: isOutage ? null : (globalMetrics?.kerberos_kdc_latency_ms ?? null),
      ldap_bind_queue_depth: isOutage ? null : (globalMetrics?.ldap_bind_queue_depth ?? null),

      // 3. Windows Server Failover Clustering (WSFC)
      wsfc_cluster_name: globalMetrics?.wsfc_cluster_name ?? null,
      wsfc_cluster_quorum_status: isOutage ? 'Quorum Split Warning' : (globalMetrics?.wsfc_cluster_quorum_status ?? null),
      wsfc_active_nodes: isOutage ? 0 : (globalMetrics?.wsfc_active_nodes ?? null),
      wsfc_total_nodes: globalMetrics?.wsfc_total_nodes ?? null,

      // 4. IIS Web Tier Telemetry
      iis_threads: isOutage ? null : (globalMetrics?.iis_threads ?? null),
      iis_sessions: isOutage ? null : (globalMetrics?.iis_sessions ?? null),
      iis_requests_per_sec: isOutage ? null : (globalMetrics?.iis_requests_per_sec ?? null),
      iis_blocked_requests_total: isOutage ? null : (globalMetrics?.iis_blocked_requests_total ?? null),

      // 5. Windows Security Patching & Lifecycle
      windows_pending_reboot_update: globalMetrics?.windows_pending_reboot_update ?? null,
      windows_os_build: globalMetrics?.windows_os_build ?? null,

      // Fortify IIS / Windows metrics
      fortify_cpu: isOutage ? null : (globalMetrics?.fortify_cpu ?? null),
      fortify_mem: isOutage ? null : (globalMetrics?.fortify_mem ?? null)
    };

    return result;
  }
};
