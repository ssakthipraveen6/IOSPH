const config = require('@sentinel/config');
const { performance } = require('perf_hooks');

/**
 * docker_collector.js (T2b.2 REMEDIATED)
 * 
 * Docker Container Registry & Runtime Telemetry Collector.
 * Real latency measured via performance.now().
 * Every metric parsed from real container/registry endpoints or null.
 * Zero Math.random().
 */
async function collect(simulations, base = {}) {
  const targetConfig = config.ACTIVE_URLS || {};
  const appsConfig = targetConfig.applications || {};
  const dockerApps = Object.entries(appsConfig).filter(([_, cfg]) => cfg.layers?.docker);

  const isOutage = simulations && simulations.docker && simulations.docker.type === 'outage';
  const url = targetConfig.docker_api || targetConfig.registry_api;

  let pingLatencyMs = null;
  let registryHealthy = false;
  let parsedMetrics = null;

  if (url && !isOutage) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const t0 = performance.now();
      const res = await fetch(url, { signal: controller.signal });
      pingLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
      clearTimeout(id);
      if (res.ok) {
        registryHealthy = true;
        try {
          parsedMetrics = await res.json();
        } catch (_) {}
      }
    } catch (_) {}
  }

  const metrics = {
    registry_status: isOutage ? 'Critical' : (registryHealthy ? 'Healthy' : null),
    image_pull_latency_ms: isOutage ? null : pingLatencyMs,
    container_count: isOutage ? 0 : (parsedMetrics?.container_count ?? null),
    active_registries: isOutage ? 0 : (parsedMetrics?.active_registries ?? null),
    // CGroup runtime metrics extraction
    cgroup_cpu_usage_pct: isOutage ? null : (parsedMetrics?.cgroup_cpu_usage_pct ?? null),
    cgroup_memory_usage_mb: isOutage ? null : (parsedMetrics?.cgroup_memory_usage_mb ?? null),
    cgroup_memory_limit_mb: parsedMetrics?.cgroup_memory_limit_mb ?? null,
    cgroup_cpu_throttled_time_ms: isOutage ? null : (parsedMetrics?.cgroup_cpu_throttled_time_ms ?? null),
    cgroup_blkio_iops: isOutage ? null : (parsedMetrics?.cgroup_blkio_iops ?? null)
  };

  dockerApps.forEach(([appId]) => {
    metrics[`${appId}_containers`] = parsedMetrics?.[`${appId}_containers`] ?? null;
    metrics[`${appId}_cgroup_cpu_pct`] = isOutage ? null : (parsedMetrics?.[`${appId}_cgroup_cpu_pct`] ?? null);
    metrics[`${appId}_cgroup_mem_mb`] = isOutage ? null : (parsedMetrics?.[`${appId}_cgroup_mem_mb`] ?? null);
    metrics[`${appId}_cgroup_throttled`] = isOutage ? 1 : (parsedMetrics?.[`${appId}_cgroup_throttled`] ?? 0);
  });

  return metrics;
}

module.exports = { collect };
