const config = require('../../../config/config');

async function collect(simulations, base = {}) {
  const appsConfig = config.PROD_URLS.applications || {};
  const k8sApps = Object.entries(appsConfig).filter(([_, cfg]) => cfg.layers?.k8s);

  const isOutage = simulations.k8s && simulations.k8s.type === 'outage';

  const metrics = {
    cluster_status: isOutage ? 'Critical' : 'Healthy',
    apiserver_latency_ms: isOutage ? 2400.0 : 18.5,
    active_namespaces: Math.max(1, k8sApps.length),
    pod_restarts: isOutage ? 12 : 0,
    // Pod and container cgroup extraction
    cgroup_pod_cpu_limit_cores: 16.0,
    cgroup_pod_memory_working_set_mb: isOutage ? 7800 : 2350,
    cgroup_pod_throttling_events: isOutage ? 42 : 0,
    cgroup_container_restarts: isOutage ? 8 : 0
  };

  k8sApps.forEach(([appId]) => {
    metrics[`${appId}_pods`] = 6;
    metrics[`${appId}_cgroup_cpu_cores`] = isOutage ? 3.8 : 0.45;
    metrics[`${appId}_cgroup_mem_working_set_mb`] = isOutage ? 1250 : 380;
  });

  return metrics;
}

module.exports = { collect };

