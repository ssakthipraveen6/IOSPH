// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  productId: 'jfrog_artifactory',
  layers: [
    {
      layer: 'network',
      status: 'HEALTHY',
      entities: [
        { id: 'vip:artifactory-prod.internal.corp', type: 'vip', name: 'artifactory-prod VIP', status: 'HEALTHY', latency_ms: 42.6 }
      ]
    },
    {
      layer: 'storage',
      status: 'DEGRADED',
      entities: [
        { id: 'storage:nas-volume-artifactory-01', type: 'storage_volume', name: 'NAS /data/filestore', status: 'DEGRADED', latency_ms: 125.0 }
      ]
    },
    {
      layer: 'host',
      status: 'HEALTHY',
      entities: [
        { id: 'host:lon-artifactory-app-01', type: 'host', name: 'lon-artifactory-app-01', status: 'HEALTHY', cpu_pct: 34.2 }
      ]
    },
    {
      layer: 'database',
      status: 'HEALTHY',
      entities: [
        { id: 'database:ora-prod-artifactory', type: 'database', name: 'ora-prod-artifactory', status: 'HEALTHY', sessions: 42 }
      ]
    },
    {
      layer: 'product',
      status: 'HEALTHY',
      entities: [
        { id: 'app:jfrog_artifactory', type: 'application', name: 'JFrog Artifactory v7.77.5', status: 'HEALTHY', p95_ms: 124.5 }
      ]
    }
  ],
  edges: [
    { from: 'vip:artifactory-prod.internal.corp', to: 'host:lon-artifactory-app-01', type: 'routes_to' },
    { from: 'host:lon-artifactory-app-01', to: 'storage:nas-volume-artifactory-01', type: 'mounts' },
    { from: 'host:lon-artifactory-app-01', to: 'database:ora-prod-artifactory', type: 'queries' },
    { from: 'host:lon-artifactory-app-01', to: 'app:jfrog_artifactory', type: 'hosts' }
  ]
};
