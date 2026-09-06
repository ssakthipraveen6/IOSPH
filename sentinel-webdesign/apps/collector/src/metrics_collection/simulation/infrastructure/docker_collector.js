/**
 * docker_collector.js (Simulation)
 * 
 * Simulated Docker runtime & container metrics for demo mode.
 */
module.exports = {
  collect: (simulations = {}, base = {}) => {
    const isOutage = simulations.docker && simulations.docker.type === 'outage';
    const isLeak = simulations.docker && simulations.docker.type === 'memory_leak';

    const apps = ['bitbucket', 'jenkins_k8s', 'artifactory', 'argocd', 'github', 'teamcity'];
    const metrics = {
      registry_status: isOutage ? 'Critical' : 'Healthy',
      image_pull_latency_ms: isOutage ? 4500.0 : parseFloat((42.0 + (Math.random() - 0.5) * 4).toFixed(1)),
      container_count: isOutage ? 12 : 52 + Math.floor((Math.random() - 0.5) * 2),
      active_registries: isOutage ? 0 : 13,
      cgroup_cpu_usage_pct: isOutage ? 94.5 : parseFloat((28.4 + (Math.random() - 0.5) * 3).toFixed(1)),
      cgroup_memory_usage_mb: isOutage ? 3840 : (isLeak ? 3650 : Math.floor(1420 + (Math.random() - 0.5) * 50)),
      cgroup_memory_limit_mb: 4096,
      cgroup_cpu_throttled_time_ms: isOutage ? 850 : Math.floor(12 + Math.random() * 5),
      cgroup_blkio_iops: isOutage ? 2400 : Math.floor(380 + (Math.random() - 0.5) * 30)
    };

    apps.forEach(appId => {
      metrics[`${appId}_containers`] = isOutage ? 1 : 4;
      metrics[`${appId}_cgroup_cpu_pct`] = isOutage ? 88.0 : parseFloat((20 + (Math.random() * 10)).toFixed(1));
      metrics[`${appId}_cgroup_mem_mb`] = isOutage ? 950 : Math.floor(300 + (Math.random() * 80));
      metrics[`${appId}_cgroup_throttled`] = isOutage ? 1 : 0;
    });

    return metrics;
  }
};
