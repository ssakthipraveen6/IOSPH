/**
 * tests/phase_g_wiring.test.js
 * Previously dormant features are now registered with the scheduler and degrade honestly.
 */
const assert = require('assert');

async function main() {
  const { buildScheduler } = require('../backend/jobs');
  const sched = buildScheduler({});
  for (const name of ['stale_processes', 'log_archive', 'inventory_sync']) {
    assert.ok(sched.jobs.has(name), `${name} must be registered with the scheduler`);
    assert.strictEqual(sched.jobs.get(name).leaderOnly, true, `${name} must run on the leader only`);
  }
  console.log('✔ stale_processes, log_archive and inventory_sync are scheduled (leader only)');

  // Without ClickHouse there is no process telemetry: DATA_UNAVAILABLE, never an invented "all clear".
  const clickhouse = require('../database/clickhouse');
  if (!clickhouse.isConfigured()) {
    const { runStaleProcessJob } = require('../backend/jobs/stale_processes');
    const out = await runStaleProcessJob({ environments: ['staging'], nowMs: Date.now() });
    assert.strictEqual(out.environments.staging.status, 'DATA_UNAVAILABLE');
    console.log('✔ stale process job reports DATA_UNAVAILABLE without ClickHouse');
  }

  // Archiver prefers ClickHouse for logs.
  const realQuery = clickhouse.query;
  const realConfigured = clickhouse.isConfigured;
  let sql = null;
  clickhouse.isConfigured = () => true;
  clickhouse.query = async (q, params) => {
    sql = { q, params };
    return [
      { ts: '2026-10-01 10:00:00', entity_id: 'host:a', app_id: 'jenkins', env: 'staging', level: 'ERROR', message: 'boom', fields: {} },
      { ts: '2026-10-01 10:00:01', entity_id: 'host:b', app_id: 'github', env: 'staging', level: 'INFO', message: 'ok', fields: {} }
    ];
  };
  const { archiveLogs } = require('../logs_collection/archival/s3_archiver');
  const res = await archiveLogs({ environment: 'staging', date: '2026-10-01' });
  clickhouse.query = realQuery;
  clickhouse.isConfigured = realConfigured;
  assert.ok(/FROM logs/.test(sql.q), 'archiver reads the ClickHouse logs table');
  assert.strictEqual(res.source, 'clickhouse');
  assert.strictEqual(res.totalLogsArchived, 2);
  assert.strictEqual(res.partitionsCreated, 2);
  console.log('✔ log archiver reads ClickHouse and partitions by app');

  console.log('PHASE G WIRING TESTS PASSED');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
