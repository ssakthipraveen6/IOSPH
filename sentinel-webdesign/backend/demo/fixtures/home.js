// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  scorecards: [
    {
      productId: 'jfrog_artifactory',
      productName: 'JFrog Artifactory',
      availabilityPct: 99.95,
      p95Ms: 124.5,
      prevP95Ms: 118.0,
      p95DeltaPct: 5.5,
      changePointsCount: 1,
      openCvesCount: 2,
      topCause: 'storage'
    },
    {
      productId: 'bitbucket',
      productName: 'Bitbucket Enterprise',
      availabilityPct: 99.80,
      p95Ms: 245.0,
      prevP95Ms: 195.0,
      p95DeltaPct: 25.6,
      changePointsCount: 2,
      openCvesCount: 0,
      topCause: 'host'
    },
    {
      productId: 'cloudbees_jenkins',
      productName: 'CloudBees Jenkins',
      availabilityPct: 99.99,
      p95Ms: 82.0,
      prevP95Ms: 95.0,
      p95DeltaPct: -13.7,
      changePointsCount: 0,
      openCvesCount: 1,
      topCause: 'product'
    },
    {
      productId: 'sonarqube',
      productName: 'SonarQube Enterprise',
      availabilityPct: 100.0,
      p95Ms: 145.0,
      prevP95Ms: 142.0,
      p95DeltaPct: 2.1,
      changePointsCount: 0,
      openCvesCount: 0,
      topCause: 'none'
    }
  ],
  activeProblems: [
    {
      id: 'PRB-DEMO-001',
      title: 'Shared NFS Storage Latency Saturation',
      severity: 'CRITICAL',
      top_layer: 'storage',
      suspect_entity: 'nas-volume-artifactory-01',
      created_at: new Date(Date.now() - 45 * 60000).toISOString(),
      alert_count: 5
    },
    {
      id: 'PRB-DEMO-002',
      title: 'Bitbucket Node 2 JVM Memory Exhaustion & Heap Pressure',
      severity: 'HIGH',
      top_layer: 'host',
      suspect_entity: 'lon-bb-node-02',
      created_at: new Date(Date.now() - 25 * 60000).toISOString(),
      alert_count: 3
    }
  ]
};
