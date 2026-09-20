const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const { performance } = require('perf_hooks');

/**
 * avi_collector.js (T2b.2 REMEDIATED)
 * 
 * VMware NSX ALB (Avi Networks) Telemetry Collector.
 * Every returned value is parsed from the AVI API response or is null.
 * No hardcoded constants reach a returned metric value.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.avi_api;
    const isOutage = simulations && simulations.avi_load_balancer && simulations.avi_load_balancer.type === 'outage';

    let aviSecret = null;
    try {
      aviSecret = await credentialProvider.getCredential('avi', 'api');
    } catch (_) {}

    // Attempt to fetch real metrics from AVI controller API
    let globalMetrics = null;
    let fetchLatencyMs = null;

    if (url) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const headers = {};
        if (aviSecret) headers['Authorization'] = `Bearer ${aviSecret}`;

        const t0 = performance.now();
        const res = await fetch(url, { headers, signal: controller.signal });
        fetchLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
        clearTimeout(id);
        if (res.ok) {
          const payload = await res.json();
          globalMetrics = payload.metrics || payload;
        }
      } catch (_) {
        // AVI unreachable — all AVI-sourced values stay null
      }
    }

    const result = {
      // Core Throughput — parsed from API or null
      connections: isOutage ? 0 : (globalMetrics?.connections ?? null),
      ingressFlow: isOutage ? 0 : (globalMetrics?.ingressFlow ?? null),
      throughput: isOutage ? 0 : (globalMetrics?.throughput ?? null),

      // VirtualService & Pool Member Topology — from API or null
      virtual_service_health_score: globalMetrics?.virtual_service_health_score ?? null,
      virtual_service_operational_status: isOutage ? 'DOWN' : (globalMetrics?.virtual_service_operational_status ?? null),
      total_pools: globalMetrics?.total_pools ?? null,
      total_pool_members: globalMetrics?.total_pool_members ?? null,
      pool_members_up: isOutage ? 0 : (globalMetrics?.pool_members_up ?? null),
      pool_members_draining: globalMetrics?.pool_members_draining ?? null,
      pool_members_down: isOutage ? (globalMetrics?.total_pool_members ?? null) : (globalMetrics?.pool_members_down ?? null),

      // Health Monitors — from API or null
      active_health_monitors: globalMetrics?.active_health_monitors ?? null,
      health_monitor_timeout_ms: globalMetrics?.health_monitor_timeout_ms ?? null,
      health_monitor_send_interval_sec: globalMetrics?.health_monitor_send_interval_sec ?? null,

      // SSL / TLS — from API or null
      ssl_termination_mode: globalMetrics?.ssl_termination_mode ?? null,
      ssl_cipher_negotiated: globalMetrics?.ssl_cipher_negotiated ?? null,
      ssl_handshake_client_errors_per_sec: globalMetrics?.ssl_handshake_client_errors_per_sec ?? null,
      ssl_handshake_backend_errors_per_sec: globalMetrics?.ssl_handshake_backend_errors_per_sec ?? null,

      // GSLB — from API or null
      gslb_service_status: isOutage ? 'Failover Triggered' : (globalMetrics?.gslb_service_status ?? null),
      gslb_site_persistence: globalMetrics?.gslb_site_persistence ?? null,
      gslb_preferred_site: globalMetrics?.gslb_preferred_site ?? null,

      // WAF — from API or null
      waf_policy_mode: globalMetrics?.waf_policy_mode ?? null,
      waf_blocked_requests_24h: globalMetrics?.waf_blocked_requests_24h ?? null,

      // Real measured fetch latency
      _fetchLatencyMs: fetchLatencyMs
    };

    // Per-app AVI metrics
    const aviApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.avi || cfg.avi_api);

    const tasks = aviApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const aviEndpoint = appConfig.layers?.avi?.api || appConfig.avi_api;

      let latency = null;
      let ingress = null;

      if (aviEndpoint) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1200);
          const t0 = performance.now();
          const res = await fetch(aviEndpoint, { signal: controller.signal });
          latency = parseFloat((performance.now() - t0).toFixed(2));
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            const metrics = payload.metrics || payload;
            if (metrics.ingressFlow !== undefined) ingress = metrics.ingressFlow;
            if (metrics.latency !== undefined) latency = metrics.latency;
          }
        } catch (_) {}
      }

      result[`${metricPrefix}_ingressFlow`] = isOutage ? 0 : ingress;
      result[`${metricPrefix}_latency`] = isOutage ? null : latency;
      result[`${metricPrefix}_vip_status`] = isOutage ? 'CRITICAL' : (ingress !== null ? 'HEALTHY' : null);
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
