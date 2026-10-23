// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  clusters: [
    {
      name: 'lon-prod-eks-01',
      version: 'v1.28.7-eks',
      nodes_ready: 24,
      nodes_total: 24,
      status: 'HEALTHY',
      workloads: [
        { name: 'argo-cd-server', cpuPercent: 32.5, cores: 64, podsDesired: 3, podsReady: 3, status: 'normal' },
        { name: 'argo-workflows-controller', cpuPercent: 44.1, cores: 128, podsDesired: 2, podsReady: 2, status: 'normal' },
        { name: 'mcp-server-daemon', cpuPercent: 18.0, cores: 32, podsDesired: 6, podsReady: 6, status: 'normal' }
      ]
    },
    {
      name: 'ny-prod-eks-02',
      version: 'v1.28.7-eks',
      nodes_ready: 36,
      nodes_total: 36,
      status: 'HEALTHY',
      workloads: [
        { name: 'bitbucket-mesh-runner', cpuPercent: 88.0, cores: 256, podsDesired: 12, podsReady: 11, status: 'degraded' },
        { name: 'jenkins-agent-pool', cpuPercent: 55.4, cores: 512, podsDesired: 40, podsReady: 40, status: 'normal' }
      ]
    }
  ]
};
