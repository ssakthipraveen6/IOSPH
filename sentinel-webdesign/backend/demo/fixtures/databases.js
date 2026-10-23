// DEMO FIXTURE — never served outside /api/demo

module.exports = {
  databases: [
    {
      name: 'ora-prod-artifactory',
      engine: 'Oracle 19c Enterprise',
      status: 'HEALTHY',
      active_sessions: 42,
      max_sessions: 500,
      buffer_cache_hit_ratio: 99.4,
      tablespace_used_pct: 68.2,
      top_wait_event: 'db file sequential read'
    },
    {
      name: 'pg-prod-telemetry',
      engine: 'PostgreSQL 16.2',
      status: 'HEALTHY',
      active_sessions: 28,
      max_sessions: 200,
      buffer_cache_hit_ratio: 99.8,
      tablespace_used_pct: 44.1,
      top_wait_event: 'ClientRead'
    },
    {
      name: 'sql-prod-teamcity',
      engine: 'Microsoft SQL Server 2022',
      status: 'HEALTHY',
      active_sessions: 19,
      max_sessions: 300,
      buffer_cache_hit_ratio: 98.9,
      tablespace_used_pct: 57.5,
      top_wait_event: 'PAGEIOLATCH_SH'
    }
  ]
};
