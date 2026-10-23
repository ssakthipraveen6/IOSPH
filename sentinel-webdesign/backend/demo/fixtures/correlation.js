// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  events: [
    {
      id: 'evt-drift-01',
      trackId: 'drift',
      trackName: 'Config Drift (IaC vs Live)',
      timestamp: '2026-09-06T07:45:00Z',
      relativeTime: '1h 15m ago',
      title: 'Drift: ASG Worker Pool Scaled Down & Downsized',
      entityId: 'bitbucket-mesh-pool',
      entityName: 'bitbucket-mesh-worker-pool',
      entityType: 'ASG Compute',
      severity: 'critical',
      badge: 'DRIFT DETECTED',
      summary: 'Live instance type changed to c6i.2xlarge (IaC expects c6i.4xlarge). Capacity dropped to 4 nodes.'
    },
    {
      id: 'evt-deploy-01',
      trackId: 'deploy',
      trackName: 'Deployments & GitOps',
      timestamp: '2026-09-06T07:50:00Z',
      relativeTime: '1h 10m ago',
      title: 'ArgoCD Sync: Bitbucket Mesh Upgrade to v8.19.2',
      entityId: 'app-bitbucket',
      entityName: 'Bitbucket Enterprise',
      entityType: 'Application',
      severity: 'warning',
      badge: 'ARGOCD SYNC-8841',
      summary: 'Rollout of Bitbucket mesh storage daemon v8.19.2 completed on 4 nodes.'
    },
    {
      id: 'evt-net-01',
      trackId: 'net',
      trackName: 'Network & AVI Flips',
      timestamp: '2026-09-06T08:00:00Z',
      relativeTime: '1h ago',
      title: 'AVI Virtual Service Pool Member Flapped: lon-bb-node-02',
      entityId: 'vip-bitbucket-prod',
      entityName: 'AVI Pool: bitbucket-http-pool',
      entityType: 'AVI Pool Member',
      severity: 'critical',
      badge: 'HEALTH MONITOR TIMEOUT',
      summary: 'Health monitor HTTP GET /status timed out after 5000ms. Node marked DOWN.'
    }
  ],
  stats: {
    totalEvents: 3,
    criticalCount: 2,
    correlatedRootCause: 'Bitbucket Node 2 JVM Memory Exhaustion'
  }
};
