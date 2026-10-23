// DEMO FIXTURE — never served outside /api/demo

module.exports = [
  {
    id: 'PRB-DEMO-001',
    title: 'Shared NFS Storage Latency Saturation',
    severity: 'CRITICAL',
    status: 'OPEN',
    environment: 'demo',
    top_layer: 'storage',
    suspect_entity: 'nas-volume-artifactory-01',
    confidence: 0.94,
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 60000).toISOString(),
    alert_count: 5,
    summary: 'NFS lock contention and IOPS saturation on shared storage controller causing cascading upload timeouts on Artifactory package repository.',
    alerts: [
      { id: 'ALT-DEMO-101', rule_id: 'nfs_rpc_timeout', title: 'NFS RPC Timeout spike > 120ms', severity: 'CRITICAL', status: 'OPEN' },
      { id: 'ALT-DEMO-102', rule_id: 'journey_upload_fail', title: 'Journey Step Upload Artifact Latency p95 > 4500ms', severity: 'CRITICAL', status: 'OPEN' },
      { id: 'ALT-DEMO-103', rule_id: 'storage_iops_saturation', title: 'NetApp LUN IOPS saturation at 98%', severity: 'HIGH', status: 'OPEN' },
      { id: 'ALT-DEMO-104', rule_id: 'disk_queue_depth', title: 'Disk Queue Depth > 64 on app mounts', severity: 'HIGH', status: 'OPEN' },
      { id: 'ALT-DEMO-105', rule_id: 'http_504_gateway_timeout', title: 'AVI VIP 504 Gateway Timeout Rate > 2%', severity: 'MEDIUM', status: 'OPEN' }
    ]
  },
  {
    id: 'PRB-DEMO-002',
    title: 'Bitbucket Node 2 JVM Memory Exhaustion & Heap Pressure',
    severity: 'HIGH',
    status: 'ACKNOWLEDGED',
    environment: 'demo',
    top_layer: 'host',
    suspect_entity: 'lon-bb-node-02',
    confidence: 0.88,
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 60000).toISOString(),
    alert_count: 3,
    summary: 'JVM Old Gen heap usage exceeded 94% on Bitbucket Node 2 leading to stop-the-world GC pauses of 4.2 seconds.',
    alerts: [
      { id: 'ALT-DEMO-201', rule_id: 'jvm_heap_exhaustion', title: 'JVM Heap Old Gen > 90% for 15m', severity: 'HIGH', status: 'ACKNOWLEDGED' },
      { id: 'ALT-DEMO-202', rule_id: 'gc_pause_spike', title: 'Garbage Collection pause time > 3000ms', severity: 'HIGH', status: 'ACKNOWLEDGED' },
      { id: 'ALT-DEMO-203', rule_id: 'http_threads_busy', title: 'Tomcat active request thread pool saturation', severity: 'MEDIUM', status: 'ACKNOWLEDGED' }
    ]
  }
];
