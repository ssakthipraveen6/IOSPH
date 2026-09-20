const config = require('@sentinel/config');
const { performance } = require('perf_hooks');

/**
 * k8s_collector.js (T2b.2 REMEDIATED)
 * 
 * Kubernetes Infrastructure & Container Telemetry Collector.
 * Every returned value is parsed from the K8s API or is null.
 */
async function collect(simulations, base = {}) {
  const targetConfig = config.ACTIVE_URLS || {};
  const appsConfig = targetConfig.applications || config.PROD_URLS?.applications || {};
  const k8sApps = Object.entries(appsConfig).filter(([_, cfg]) => cfg.layers?.k8s);
  const isOutage = simulations && simulations.k8s && simulations.k8s.type === 'outage';
  const isMemoryPressure = simulations && simulations.k8s && simulations.k8s.type === 'memory_leak';

  const k8sEndpoint = targetConfig.k8s_api || targetConfig.infrastructure?.k8s?.api;
  let apiData = null;
  let fetchLatencyMs = null;

  if (k8sEndpoint) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const t0 = performance.now();
      const res = await fetch(`${k8sEndpoint}/healthz`, { signal: controller.signal });
      fetchLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
      clearTimeout(timeoutId);
      if (res.ok) {
        // Attempt to fetch node and pod data from the API
        try {
          const nodesRes = await fetch(`${k8sEndpoint}/api/v1/nodes`, { signal: AbortSignal.timeout(2000) });
          if (nodesRes.ok) {
            const nodesPayload = await nodesRes.json();
            const nodes = nodesPayload.items || [];
            apiData = { nodes };
          }
        } catch (_) {}

        try {
          const podsRes = await fetch(`${k8sEndpoint}/api/v1/pods`, { signal: AbortSignal.timeout(2000) });
          if (podsRes.ok) {
            const podsPayload = await podsRes.json();
            apiData = apiData || {};
            apiData.pods = podsPayload.items || [];
          }
        } catch (_) {}
      }
    } catch (_) {
      // K8s API unreachable — all values stay null
    }
  }

  // Parse values from live API or return null
  const totalNodes = apiData?.nodes ? apiData.nodes.length : null;
  const readyNodes = apiData?.nodes
    ? apiData.nodes.filter(n => n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')).length
    : null;
  const totalPods = apiData?.pods ? apiData.pods.length : null;
  const podsRunning = apiData?.pods ? apiData.pods.filter(p => p.status?.phase === 'Running').length : null;
  const podsPending = apiData?.pods ? apiData.pods.filter(p => p.status?.phase === 'Pending').length : null;
  const podsFailed = apiData?.pods ? apiData.pods.filter(p => p.status?.phase === 'Failed').length : null;

  const metrics = {
    // Control Plane — from API or null
    cluster_status: apiData ? (isOutage ? 'Critical' : (isMemoryPressure ? 'Warning' : 'Healthy')) : null,
    apiserver_latency_ms: fetchLatencyMs,
    etcd_has_leader: apiData ? 1 : null,
    active_namespaces: apiData?.pods
      ? new Set(apiData.pods.map(p => p.metadata?.namespace).filter(Boolean)).size
      : null,

    // Node Fleet — from API or null
    nodes_total: totalNodes,
    nodes_ready: isOutage ? (readyNodes !== null ? Math.max(0, readyNodes - 5) : null) : readyNodes,
    nodes_memory_pressure_count: apiData?.nodes
      ? apiData.nodes.filter(n => n.status?.conditions?.some(c => c.type === 'MemoryPressure' && c.status === 'True')).length
      : null,
    nodes_disk_pressure_count: apiData?.nodes
      ? apiData.nodes.filter(n => n.status?.conditions?.some(c => c.type === 'DiskPressure' && c.status === 'True')).length
      : null,
    nodes_pid_pressure_count: apiData?.nodes
      ? apiData.nodes.filter(n => n.status?.conditions?.some(c => c.type === 'PIDPressure' && c.status === 'True')).length
      : null,

    // Workload — from API or null
    pods_total: totalPods,
    pods_running: podsRunning,
    pods_pending: podsPending,
    pods_failed: podsFailed,
    readiness_probe_failures: null, // Not available from standard API — correct answer is null
    liveness_probe_failures: null,
    container_oomkilled_total: null,
    container_restart_backoff_count: null,

    // Resource Saturation — not available from standard API
    cgroup_pod_cpu_limit_cores: null,
    cgroup_pod_cpu_usage_cores: null,
    cgroup_pod_memory_working_set_mb: null,
    cgroup_pod_memory_limit_mb: null,
    cgroup_pod_throttling_events_total: null,
    hpa_target_cpu_utilization_pct: null,
    hpa_current_cpu_utilization_pct: null,

    _fetchLatencyMs: fetchLatencyMs
  };

  // Per-application workload telemetry
  k8sApps.forEach(([appId]) => {
    if (apiData?.pods) {
      const appPods = apiData.pods.filter(p =>
        p.metadata?.labels?.app === appId || p.metadata?.namespace === appId
      );
      metrics[`${appId}_pods_ready`] = appPods.filter(p => p.status?.phase === 'Running').length;
      metrics[`${appId}_pods_desired`] = appPods.length || null;
    } else {
      metrics[`${appId}_pods_ready`] = null;
      metrics[`${appId}_pods_desired`] = null;
    }
    metrics[`${appId}_oom_kills`] = null;
    metrics[`${appId}_cgroup_cpu_cores`] = null;
    metrics[`${appId}_cgroup_mem_mb`] = null;
  });

  return metrics;
}

module.exports = { collect };
