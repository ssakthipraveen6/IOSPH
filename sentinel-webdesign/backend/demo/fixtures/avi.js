// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  vips: [
    {
      vip_name: 'artifactory-prod.internal.corp',
      ip: '10.128.4.15',
      port: 443,
      status: 'UP',
      tls_version: 'TLSv1.3',
      cert_days_remaining: 84,
      timings: { dns_ms: 0.8, tcp_ms: 3.2, tls_ms: 4.1, ttfb_ms: 34.5, total_ms: 42.6 },
      pool_members_total: 4,
      pool_members_up: 4,
      overhead_ms: 18.2
    },
    {
      vip_name: 'bitbucket-prod.internal.corp',
      ip: '10.128.4.20',
      port: 443,
      status: 'UP',
      tls_version: 'TLSv1.3',
      cert_days_remaining: 14,
      timings: { dns_ms: 1.1, tcp_ms: 3.8, tls_ms: 4.9, ttfb_ms: 68.2, total_ms: 78.0 },
      pool_members_total: 3,
      pool_members_up: 2,
      overhead_ms: 22.0
    },
    {
      vip_name: 'jenkins-prod.internal.corp',
      ip: '10.128.4.30',
      port: 443,
      status: 'UP',
      tls_version: 'TLSv1.3',
      cert_days_remaining: 142,
      timings: { dns_ms: 0.6, tcp_ms: 2.9, tls_ms: 3.5, ttfb_ms: 21.0, total_ms: 28.0 },
      pool_members_total: 2,
      pool_members_up: 2,
      overhead_ms: 9.5
    }
  ],
  waf_metrics: {
    inspected_req_sec: 1420,
    blocked_req_sec: 2,
    threat_intel_match_sec: 0,
    last_block_at: new Date(Date.now() - 18 * 60000).toISOString()
  }
};
