// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  products: [
    {
      id: 'jfrog_artifactory',
      name: 'JFrog Artifactory',
      version: '7.77.5',
      category: 'artifact_repository',
      status: 'DEGRADED',
      availability_pct: 99.95,
      p95_latency_ms: 124.5,
      layers: {
        network: 'HEALTHY',
        storage: 'DEGRADED',
        host: 'HEALTHY',
        database: 'HEALTHY',
        product: 'HEALTHY'
      },
      journeys: [
        { id: 'artifactory_health', name: 'Health ping & version check', p95_ms: 22.4, status: 'HEALTHY' },
        { id: 'artifactory_upload', name: 'Canary artifact upload & checksum', p95_ms: 4500.0, status: 'FAILING' },
        { id: 'artifactory_download', name: 'Canary artifact download', p95_ms: 48.0, status: 'HEALTHY' }
      ]
    },
    {
      id: 'bitbucket',
      name: 'Bitbucket Enterprise',
      version: '8.19.2',
      category: 'source_control',
      status: 'DEGRADED',
      availability_pct: 99.80,
      p95_latency_ms: 245.0,
      layers: {
        network: 'HEALTHY',
        storage: 'HEALTHY',
        host: 'DEGRADED',
        database: 'HEALTHY',
        product: 'HEALTHY'
      },
      journeys: [
        { id: 'bitbucket_web_browse', name: 'Browse canary repository commit list', p95_ms: 310.0, status: 'DEGRADED' },
        { id: 'bitbucket_git_pull', name: 'Git clone and pull reference commit', p95_ms: 180.0, status: 'HEALTHY' }
      ]
    },
    {
      id: 'cloudbees_jenkins',
      name: 'CloudBees Jenkins',
      version: '2.440.3',
      category: 'ci_cd',
      status: 'HEALTHY',
      availability_pct: 99.99,
      p95_latency_ms: 82.0,
      layers: {
        network: 'HEALTHY',
        storage: 'HEALTHY',
        host: 'HEALTHY',
        database: 'HEALTHY',
        product: 'HEALTHY'
      },
      journeys: [
        { id: 'jenkins_master_ping', name: 'Master HTTP health probe', p95_ms: 18.0, status: 'HEALTHY' },
        { id: 'jenkins_canary_job', name: 'Trigger canary pipeline and verify build', p95_ms: 145.0, status: 'HEALTHY' }
      ]
    }
  ]
};
