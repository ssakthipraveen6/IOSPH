/**
 * k8s_collector.js (Simulation)
 * 
 * Simulated Kubernetes infrastructure & pod metrics for demo mode.
 */
module.exports = {
  collect: (simulations = {}, base = {}) => {
    const isOutage = simulations.k8s && simulations.k8s.type === 'outage';
    const isMemoryPressure = simulations.k8s && simulations.k8s.type === 'memory_leak';

    const totalNodes = 12;
    const readyNodes = isOutage ? 7 : 12;
    const totalPods = 36;

    const metrics = {
      cluster_status: isOutage ? 'Critical' : (isMemoryPressure ? 'Warning' : 'Healthy'),
      apiserver_latency_ms: isOutage ? 2450.0 : (isMemoryPressure ? 145.0 : parseFloat((16.8 + (Math.random() - 0.5) * 2).toFixed(1))),
      etcd_has_leader: isOutage ? 0 : 1,
      active_namespaces: 13,

      nodes_total: totalNodes,
      nodes_ready: readyNodes,
      nodes_memory_pressure_count: (isOutage || isMemoryPressure) ? 3 : 0,
      nodes_disk_pressure_count: isOutage ? 1 : 0,
      nodes_pid_pressure_count: 0,

      pods_total: totalPods,
      pods_running: isOutage ? (totalPods - 8) : totalPods,
      pods_pending: isOutage ? 6 : 0,
      pods_failed: isOutage ? 2 : 0,
      readiness_probe_failures: isOutage ? 14 : (isMemoryPressure ? 4 : 0),
      liveness_probe_failures: isOutage ? 6 : 0,
      container_oomkilled_total: isOutage ? 8 : (isMemoryPressure ? 3 : 0),
      container_restart_backoff_count: isOutage ? 5 : 0,

      cgroup_pod_cpu_limit_cores: 64.0,
      cgroup_pod_cpu_usage_cores: isOutage ? 58.4 : parseFloat((18.2 + (Math.random() - 0.5) * 2).toFixed(2)),
      cgroup_pod_memory_working_set_mb: isOutage ? 48500 : (isMemoryPressure ? 39200 : Math.floor(16800 + (Math.random() - 0.5) * 400)),
      cgroup_pod_memory_limit_mb: 65536,
      cgroup_pod_throttling_events_total: isOutage ? 128 : (isMemoryPressure ? 34 : Math.floor(2 + Math.random() * 2)),
      hpa_target_cpu_utilization_pct: 75,
      hpa_current_cpu_utilization_pct: isOutage ? 94 : (isMemoryPressure ? 86 : Math.floor(42 + (Math.random() - 0.5) * 6))
    };

    const k8sApps = ['jenkins_k8s', 'argocd', 'argoworkflows', 'mcp_server_k8s'];
    k8sApps.forEach(appId => {
      metrics[`${appId}_pods_ready`] = isOutage ? 2 : 6;
      metrics[`${appId}_pods_desired`] = 6;
      metrics[`${appId}_oom_kills`] = isOutage ? 2 : (isMemoryPressure ? 1 : 0);
      metrics[`${appId}_cgroup_cpu_cores`] = isOutage ? 3.8 : parseFloat((0.45 + (Math.random() - 0.5) * 0.1).toFixed(2));
      metrics[`${appId}_cgroup_mem_mb`] = isOutage ? 1250 : (isMemoryPressure ? 920 : Math.floor(380 + (Math.random() - 0.5) * 30));
    });

    return metrics;
  }
};
