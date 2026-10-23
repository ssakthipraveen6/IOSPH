// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  hosts: [
    {
      hostname: 'lon-artifactory-app-01.internal.corp',
      os: 'RHEL 9.3',
      agent_version: '2.4.0',
      status: 'HEALTHY',
      last_seen: new Date(Date.now() - 30000).toISOString(),
      config_hash: 'a1b2c3d4',
      cpu_usage_pct: 34.2,
      mem_usage_pct: 68.5,
      product: 'jfrog_artifactory'
    },
    {
      hostname: 'lon-bb-node-02.internal.corp',
      os: 'RHEL 9.3',
      agent_version: '2.4.0',
      status: 'DEGRADED',
      last_seen: new Date(Date.now() - 15000).toISOString(),
      config_hash: 'a1b2c3d4',
      cpu_usage_pct: 82.1,
      mem_usage_pct: 94.2,
      product: 'bitbucket'
    },
    {
      hostname: 'ny-jenkins-controller-01.internal.corp',
      os: 'Windows Server 2022',
      agent_version: '2.4.0',
      status: 'HEALTHY',
      last_seen: new Date(Date.now() - 40000).toISOString(),
      config_hash: 'f5e6d7c8',
      cpu_usage_pct: 22.4,
      mem_usage_pct: 54.0,
      product: 'cloudbees_jenkins'
    }
  ],
  summary: {
    total_hosts: 980,
    active_agents: 968,
    silent_hosts: 12,
    drifted_configs: 0,
    os_breakdown: { linux: 520, windows: 460 }
  }
};
