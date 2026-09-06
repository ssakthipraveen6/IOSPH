const config = require('../../../config/config');

/**
 * k8s_collector.js
 * 
 * Domain-Expert Kubernetes Infrastructure & Container Telemetry Collector
 * Separates Cluster Control Plane, Node Capacity/Pressure, and Pod Lifecycle.
 */
async function collect(simulations, base = {}) {
  const targetConfig = config.ACTIVE_URLS || {};
  const appsConfig = targetConfig.applications || config.PROD_URLS?.applications || {};
  const k8sApps = Object.entries(appsConfig).filter(([_, cfg]) => cfg.layers?.k8s);
  const isOutage = simulations && simulations.k8s && simulations.k8s.type === 'outage';
  const isMemoryPressure = simulations && simulations.k8s && simulations.k8s.type === 'memory_leak';

  const k8sEndpoint = targetConfig.k8s_api || targetConfig.infrastructure?.k8s?.api;
  let liveApiAvailable = false;

  if (k8sEndpoint) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${k8sEndpoint}/healthz`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) liveApiAvailable = true;
    } catch (_) {
      // Handled via baseline / segregation logic
    }
  }

  // Model realistic multi-tier K8s metrics
  const totalNodes = 12;
  const readyNodes = isOutage ? 7 : 12;
  const totalPods = Math.max(24, k8sApps.length * 6);

  const metrics = {
    // 1. Control Plane & Cluster Tier
    cluster_status: isOutage ? 'Critical' : (isMemoryPressure ? 'Warning' : 'Healthy'),
    apiserver_latency_ms: isOutage ? 2450.0 : (isMemoryPressure ? 145.0 : 16.8),
    etcd_has_leader: isOutage ? 0 : 1,
    active_namespaces: Math.max(4, k8sApps.length + 2),

    // 2. Node Fleet & Pressure Conditions Tier
    nodes_total: totalNodes,
    nodes_ready: readyNodes,
    nodes_memory_pressure_count: (isOutage || isMemoryPressure) ? 3 : 0,
    nodes_disk_pressure_count: isOutage ? 1 : 0,
    nodes_pid_pressure_count: 0,

    // 3. Workload, Probes & Container Runtime Tier
    pods_total: totalPods,
    pods_running: isOutage ? (totalPods - 8) : totalPods,
    pods_pending: isOutage ? 6 : 0,
    pods_failed: isOutage ? 2 : 0,
    readiness_probe_failures: isOutage ? 14 : (isMemoryPressure ? 4 : 0),
    liveness_probe_failures: isOutage ? 6 : 0,
    container_oomkilled_total: isOutage ? 8 : (isMemoryPressure ? 3 : 0),
    container_restart_backoff_count: isOutage ? 5 : 0,

    // 4. Resource Saturation & HPA Autoscaling
    cgroup_pod_cpu_limit_cores: 64.0,
    cgroup_pod_cpu_usage_cores: isOutage ? 58.4 : 18.2,
    cgroup_pod_memory_working_set_mb: isOutage ? 48500 : (isMemoryPressure ? 39200 : 16800),
    cgroup_pod_memory_limit_mb: 65536,
    cgroup_pod_throttling_events_total: isOutage ? 128 : (isMemoryPressure ? 34 : 2),
    hpa_target_cpu_utilization_pct: 75,
    hpa_current_cpu_utilization_pct: isOutage ? 94 : (isMemoryPressure ? 86 : 42)
  };

  // Per-application workload telemetry
  k8sApps.forEach(([appId]) => {
    metrics[`${appId}_pods_ready`] = isOutage ? 3 : 6;
    metrics[`${appId}_pods_desired`] = 6;
    metrics[`${appId}_oom_kills`] = isOutage ? 2 : 0;
    metrics[`${appId}_cgroup_cpu_cores`] = isOutage ? 3.8 : 0.45;
    metrics[`${appId}_cgroup_mem_mb`] = isOutage ? 1250 : 380;
  });

  return metrics;
}

module.exports = { collect };
