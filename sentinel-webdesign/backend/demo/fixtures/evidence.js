// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  id: 'PRB-DEMO-001',
  title: 'Shared NFS Storage Latency Saturation',
  severity: 'CRITICAL',
  top_layer: 'storage',
  suspect_entity: 'nas-volume-artifactory-01',
  confidence: 0.94,
  time_window: 'Last 60 minutes',
  created_at: new Date(Date.now() - 45 * 60000).toISOString(),
  executive_summary: 'Storage layer contention on NAS controller NetApp-Filer-02 causing NFS RPC lock timeouts, driving artifact upload step duration from 118ms to 4500ms.',
  metric_series: [
    { ts: new Date(Date.now() - 50 * 60000).toISOString(), value: 12.0 },
    { ts: new Date(Date.now() - 45 * 60000).toISOString(), value: 45.0 },
    { ts: new Date(Date.now() - 40 * 60000).toISOString(), value: 124.0 },
    { ts: new Date(Date.now() - 35 * 60000).toISOString(), value: 165.0 },
    { ts: new Date(Date.now() - 30 * 60000).toISOString(), value: 180.0 },
    { ts: new Date(Date.now() - 25 * 60000).toISOString(), value: 172.0 }
  ],
  associated_alerts: [
    { title: 'NFS RPC Timeout spike > 120ms', severity: 'CRITICAL' },
    { title: 'NetApp LUN IOPS saturation at 98%', severity: 'HIGH' }
  ],
  version_changes: [],
  file_changes: [],
  cves: []
};
