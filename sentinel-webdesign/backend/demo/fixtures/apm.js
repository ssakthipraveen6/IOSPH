// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  deployments: [
    {
      id: 'dep-demo-01',
      app: 'bitbucket',
      version: '8.19.2',
      deployed_at: new Date(Date.now() - 70 * 60000).toISOString(),
      deployed_by: 'argocd-sync-bot',
      status: 'SUCCESS'
    },
    {
      id: 'dep-demo-02',
      app: 'jfrog_artifactory',
      version: '7.77.5',
      deployed_at: new Date(Date.now() - 180 * 60000).toISOString(),
      deployed_by: 'jenkins-pipeline',
      status: 'SUCCESS'
    }
  ],
  flamegraph: {
    name: 'root',
    value: 4500,
    children: [
      {
        name: 'artifactory.upload',
        value: 4500,
        children: [
          { name: 'nfs_rpc_write', value: 4320 },
          { name: 'checksum_sha256', value: 120 },
          { name: 'metadata_commit', value: 60 }
        ]
      }
    ]
  }
};
