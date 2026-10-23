// DEMO FIXTURE — never served outside /api/demo

module.exports = [
  {
    id: 'ALT-DEMO-101',
    rule_id: 'nfs_rpc_timeout',
    title: 'NFS RPC Timeout spike > 120ms',
    severity: 'CRITICAL',
    status: 'OPEN',
    entity_id: 'nas-volume-artifactory-01',
    created_at: new Date(Date.now() - 44 * 60000).toISOString(),
    problem_id: 'PRB-DEMO-001'
  },
  {
    id: 'ALT-DEMO-102',
    rule_id: 'journey_upload_fail',
    title: 'Journey Step Upload Artifact Latency p95 > 4500ms',
    severity: 'CRITICAL',
    status: 'OPEN',
    entity_id: 'jfrog_artifactory',
    created_at: new Date(Date.now() - 40 * 60000).toISOString(),
    problem_id: 'PRB-DEMO-001'
  },
  {
    id: 'ALT-DEMO-103',
    rule_id: 'storage_iops_saturation',
    title: 'NetApp LUN IOPS saturation at 98%',
    severity: 'HIGH',
    status: 'OPEN',
    entity_id: 'nas-volume-artifactory-01',
    created_at: new Date(Date.now() - 38 * 60000).toISOString(),
    problem_id: 'PRB-DEMO-001'
  },
  {
    id: 'ALT-DEMO-201',
    rule_id: 'jvm_heap_exhaustion',
    title: 'JVM Heap Old Gen > 90% for 15m',
    severity: 'HIGH',
    status: 'ACKNOWLEDGED',
    entity_id: 'lon-bb-node-02',
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    problem_id: 'PRB-DEMO-002',
    acked_by: 'lead_sre'
  },
  {
    id: 'ALT-DEMO-301',
    rule_id: 'cert_expiry_approaching',
    title: 'TLS Certificate Expiry within 14 days on VIP bitbucket.internal.corp',
    severity: 'MEDIUM',
    status: 'SNOOZED',
    entity_id: 'vip-bitbucket-prod',
    created_at: new Date(Date.now() - 120 * 60000).toISOString(),
    snoozed_until: new Date(Date.now() + 24 * 3600000).toISOString()
  }
];
