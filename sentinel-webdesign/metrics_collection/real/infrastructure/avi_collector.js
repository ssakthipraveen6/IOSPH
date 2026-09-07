const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');

/**
 * avi_collector.js
 * 
 * Domain-Expert VMware NSX ALB (Avi Networks) Telemetry Collector
 * Structures VirtualService health, Pool Member drain states, SSL/TLS handshake
 * termination points, and GSLB cross-site routing.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.avi_api;
    const isOutage = simulations && simulations.avi_load_balancer && simulations.avi_load_balancer.type === 'outage';

    let globalMetrics = {};
    let aviSecret = null;
    try {
      aviSecret = await credentialProvider.getCredential('avi', 'api');
    } catch (_) {}

    if (url) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500);
        const headers = {};
        if (aviSecret) headers['Authorization'] = `Bearer ${aviSecret}`;

        const res = await fetch(url, { headers, signal: controller.signal });
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
      // 1. Core Throughput & Connection Golden Signals
      connections: isOutage ? 420 : (globalMetrics.connections !== undefined ? globalMetrics.connections : (base.connections || 1520)),
      ingressFlow: isOutage ? 4.2 : (globalMetrics.ingressFlow !== undefined ? globalMetrics.ingressFlow : (base.ingressFlow || 45.2)),
      throughput: isOutage ? 15 : (globalMetrics.throughput !== undefined ? globalMetrics.throughput : (base.throughput || 120)),

      // 2. AVI VirtualService & Pool Member Topology
      virtual_service_health_score: isOutage ? 18 : 98,
      virtual_service_operational_status: isOutage ? 'DOWN' : 'OPERATIONAL',
      total_pools: 13,
      total_pool_members: 48,
      pool_members_up: isOutage ? 12 : 46,
      pool_members_draining: isOutage ? 0 : 2, // Graceful maintenance draining
      pool_members_down: isOutage ? 36 : 0,

      // 3. Health Monitors
      active_health_monitors: 'System-HTTP, System-TCP, System-HTTPS',
      health_monitor_timeout_ms: 4000,
      health_monitor_send_interval_sec: 10,

      // 4. SSL / TLS Termination & Handshake Diagnostics
      ssl_termination_mode: 'Edge Termination (Client-SSL Profile)',
      ssl_cipher_negotiated: 'TLS_AES_256_GCM_SHA384 (TLSv1.3)',
      ssl_handshake_client_errors_per_sec: isOutage ? 45 : 0,
      ssl_handshake_backend_errors_per_sec: 0,

      // 5. GSLB (Global Server Load Balancing)
      gslb_service_status: isOutage ? 'Failover Triggered' : 'Active-Active Synced',
      gslb_site_persistence: 'Enabled (Source IP Hash)',
      gslb_preferred_site: 'LON-DC-01 (Primary)',

      // 6. WAF (Web Application Firewall)
      waf_policy_mode: 'Enforcement',
      waf_blocked_requests_24h: isOutage ? 124 : 14
    };

    // Dynamically filter all apps with AVI layer configuration
    const aviApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.avi || cfg.avi_api);

    const tasks = aviApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const aviEndpoint = appConfig.layers?.avi?.api || appConfig.avi_api;

      let latency = base[`${metricPrefix}_latency`] || 45.0;
      let ingress = base[`${metricPrefix}_ingressFlow`] || 15.0;

      if (aviEndpoint) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 1200);
          const res = await fetch(aviEndpoint, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            const payload = await res.json();
            const metrics = payload.metrics || {};
            if (metrics.ingressFlow !== undefined) ingress = metrics.ingressFlow;
            if (metrics.latency !== undefined) latency = metrics.latency;
          }
        } catch (_) {}
      }

      result[`${metricPrefix}_ingressFlow`] = isOutage ? 0.0 : ingress;
      result[`${metricPrefix}_latency`] = isOutage ? 1450.0 : latency;
      result[`${metricPrefix}_vip_status`] = isOutage ? 'CRITICAL' : 'HEALTHY';
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
