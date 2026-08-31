const config = require('../../../config/config');

async function collect(simulations, base = {}) {
  const appsConfig = config.PROD_URLS.applications || {};
  const dockerApps = Object.entries(appsConfig).filter(([_, cfg]) => cfg.layers?.docker);

  const isOutage = simulations.docker && simulations.docker.type === 'outage';

  const metrics = {
    registry_status: isOutage ? 'Critical' : 'Healthy',
    image_pull_latency_ms: isOutage ? 4500.0 : 42.0,
    container_count: Math.max(16, dockerApps.length * 4),
    active_registries: Math.max(1, dockerApps.length),
    // CGroup runtime metrics extraction
    cgroup_cpu_usage_pct: isOutage ? 94.5 : 28.4,
    cgroup_memory_usage_mb: isOutage ? 3840 : 1420,
    cgroup_memory_limit_mb: 4096,
    cgroup_cpu_throttled_time_ms: isOutage ? 850 : 12,
    cgroup_blkio_iops: isOutage ? 2400 : 380
  };

  dockerApps.forEach(([appId]) => {
    metrics[`${appId}_containers`] = 4;
    metrics[`${appId}_cgroup_cpu_pct`] = isOutage ? 88.0 : parseFloat((20 + (Math.random() * 10)).toFixed(1));
    metrics[`${appId}_cgroup_mem_mb`] = isOutage ? 950 : Math.floor(300 + (Math.random() * 80));
    metrics[`${appId}_cgroup_throttled`] = isOutage ? 1 : 0;
  });

  return metrics;
}

module.exports = { collect };

