// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  awaitingApproval: [
    {
      id: 'REC-DEMO-901',
      component: 'bitbucket-node-02',
      action: 'Graceful Process Restart & Heap Dump Capture',
      requested_by: 'sentinel-auto-recovery',
      created_at: new Date(Date.now() - 10 * 60000).toISOString(),
      status: 'AWAITING_CO_SIGNATURE'
    }
  ],
  auditTrail: [
    {
      id: 'AUD-DEMO-01',
      action: 'RECOVERY_CO_SIGNED',
      user: 'lead.sre@enterprise.corp',
      timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      details: 'Approved autonomous restart of Jenkins agent pool runner 4'
    },
    {
      id: 'AUD-DEMO-02',
      action: 'CHANGE_WINDOW_OPENED',
      user: 'lead.sre@enterprise.corp',
      timestamp: new Date(Date.now() - 120 * 60000).toISOString(),
      details: 'Opened 60-minute emergency maintenance window for Bitbucket Mesh upgrade'
    }
  ]
};
