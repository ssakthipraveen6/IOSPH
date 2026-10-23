// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  dashboards: [
    {
      id: 'demo-dash-001',
      slug: 'demo-toolchain-overview',
      title: 'DevOps Toolchain Demo Overview',
      description: 'Sample operational overview across core bank developer tooling',
      panels: [
        { id: 'dp-1', title: 'Average Latency (ms)', type: 'stat', value: '124.5 ms', status: 'HEALTHY' },
        { id: 'dp-2', title: 'Pipeline Success Rate', type: 'stat', value: '99.94%', status: 'HEALTHY' },
        { id: 'dp-3', title: 'Open Incident Alerts', type: 'stat', value: '2 Active', status: 'CRITICAL' },
        { id: 'dp-4', title: 'Monitored Fleet Hosts', type: 'stat', value: '968 / 980', status: 'HEALTHY' }
      ]
    }
  ]
};
