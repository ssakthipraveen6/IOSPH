/**
 * tests/phase_a_db_security.test.js
 *
 * Phase A acceptance for:
 *  - A7 GET /api/v2/databases/overview shapes PostgreSQL / Oracle / SQL Server
 *    OpenTelemetry receiver metrics (fake ClickHouse rows) per database, with
 *    null for missing fields, and DATA_UNAVAILABLE when nothing is stored.
 *  - A8 GET /api/v2/security/summary returns per-host / per-product counts from
 *    stored cve_findings rows only, and an empty state when there are none.
 *  - Both routes send parameterised SQL: the environment is a `param_env`
 *    URL parameter, never interpolated into the statement.
 */

process.env.SENTINEL_JOBS_QUIET = 'true';
process.env.SENTINEL_ALLOW_LOCALHOST_CORS = 'true';
if (!process.env.SENTINEL_JWT_SECRET || process.env.SENTINEL_JWT_SECRET.length < 32) {
  process.env.SENTINEL_JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}

const assert = require('assert');
const http = require('http');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const { app } = require('../backend/server');
const { DB_RECEIVER_METRICS } = require('../backend/routes/databaseRoutes');

const closers = [];
const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

const DB_ROWS = [
  // PostgreSQL: one database on host pg01, two lock series, two replication metrics.
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.backends', series: '{}', value: 12, last_ms: NOW - 60000 },
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.db_size', series: '{}', value: 1048576, last_ms: NOW - 60000 },
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.database.locks', series: "{'mode':'AccessShareLock'}", value: 3, last_ms: NOW - 30000 },
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.database.locks', series: "{'mode':'RowExclusiveLock'}", value: 2, last_ms: NOW - 30000 },
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.wal.lag', series: '{}', value: 0.5, last_ms: NOW - 30000 },
  { entity_id: 'host:pg01', component: 'pg01', db_name: 'orders', metric_name: 'postgresql.replication.data_delay', series: '{}', value: 2048, last_ms: NOW - 30000 },
  // Oracle: sessions and tablespace split across series (summed).
  { entity_id: 'host:ora01', component: 'ora01', db_name: '', metric_name: 'oracledb.sessions.usage', series: "{'session_type':'USER'}", value: 40, last_ms: NOW - 20000 },
  { entity_id: 'host:ora01', component: 'ora01', db_name: '', metric_name: 'oracledb.sessions.usage', series: "{'session_type':'BACKGROUND'}", value: 2, last_ms: NOW - 20000 },
  { entity_id: 'host:ora01', component: 'ora01', db_name: '', metric_name: 'oracledb.tablespace_size.usage', series: "{'tablespace_name':'USERS'}", value: 100, last_ms: NOW - 20000 },
  { entity_id: 'host:ora01', component: 'ora01', db_name: '', metric_name: 'oracledb.tablespace_size.usage', series: "{'tablespace_name':'SYSTEM'}", value: 200, last_ms: NOW - 20000 },
  { entity_id: 'host:ora01', component: 'ora01', db_name: '', metric_name: 'oracledb.enqueue_locks.usage', series: '{}', value: 7, last_ms: NOW - 20000 },
  // SQL Server: stored through the OTLP normalizer, so '.' became '_' in one name.
  { entity_id: 'host:sql01', component: 'sql01', db_name: '', metric_name: 'sqlserver_user_connection_count', series: '{}', value: 19, last_ms: NOW - 10000 },
  { entity_id: 'host:sql01', component: 'sql01', db_name: '', metric_name: 'sqlserver.lock.wait.rate', series: '{}', value: 1.5, last_ms: NOW - 10000 },
  { entity_id: 'host:sql01', component: 'sql01', db_name: '', metric_name: 'sqlserver.lock.wait_time.avg', series: '{}', value: 4.2, last_ms: NOW - 10000 },
  // Not a database receiver metric: ignored.
  { entity_id: 'host:sql01', component: 'sql01', db_name: '', metric_name: 'cpu', series: '{}', value: 99, last_ms: NOW - 10000 }
];

const CVE_ROWS = [
  { host: 'bb-node-01', product_id: 'bitbucket', package_name: 'openssl', version: '1.1.1k', cve_id: 'CVE-2026-0001', severity: 'CRITICAL', cvss_score: 9.8, description: 'heap overflow', remediation: 'upgrade to 3.0.15', is_eol: 0, ts_ms: NOW - 3600000, last_scan_ms: NOW - 3600000 },
  { host: 'bb-node-01', product_id: 'bitbucket', package_name: 'log4j-core', version: '1.2.17', cve_id: 'CVE-2026-0002', severity: 'HIGH', cvss_score: 7.5, description: 'deserialisation', remediation: 'replace with 2.x', is_eol: 1, ts_ms: NOW - 3600000, last_scan_ms: NOW - 3600000 },
  { host: 'bb-node-01', product_id: 'bitbucket', package_name: 'zlib', version: '1.2.11', cve_id: 'CVE-2026-0003', severity: 'MEDIUM', cvss_score: 5.1, description: '', remediation: '', is_eol: 0, ts_ms: NOW - 3600000, last_scan_ms: NOW - 3600000 },
  { host: 'bb-node-02', product_id: 'bitbucket', package_name: 'openssl', version: '1.1.1k', cve_id: 'CVE-2026-0001', severity: 'CRITICAL', cvss_score: 9.1, description: 'heap overflow', remediation: 'upgrade to 3.0.15', is_eol: 0, ts_ms: NOW - 7200000, last_scan_ms: NOW - 7200000 },
  { host: 'jira-01', product_id: 'jira', package_name: 'python', version: '2.7.18', cve_id: 'CVE-2026-0004', severity: 'LOW', cvss_score: 2.0, description: '', remediation: '', is_eol: 1, ts_ms: NOW - 600000, last_scan_ms: NOW - 600000 }
];

async function run() {
  console.log('=== RUNNING PHASE A: DATABASE & SECURITY VIEW TESTS ===');
  const appServer = http.createServer(app);
  const appPort = await listen(appServer);
  closers.push(() => { appServer.closeAllConnections(); appServer.close(); });
  const base = `http://127.0.0.1:${appPort}`;
  const getJson = async (p) => {
    const r = await fetch(`${base}${p}`);
    assert.strictEqual(r.status, 200, `${p} -> HTTP ${r.status}`);
    return r.json();
  };

  // ---------------------------------------------------------------- not configured
  process.env.CLICKHOUSE_URL = '';
  const dbOff = await getJson('/api/v2/databases/overview?environment=staging');
  assert.strictEqual(dbOff.status, 'DATA_UNAVAILABLE');
  assert.strictEqual(dbOff.prototype, false);
  assert.strictEqual(dbOff.environment, 'staging');
  assert.deepStrictEqual(dbOff.databases, []);
  assert.ok(/not configured/i.test(dbOff.reason));
  const secOff = await getJson('/api/v2/security/summary?environment=staging');
  assert.strictEqual(secOff.status, 'DATA_UNAVAILABLE');
  assert.deepStrictEqual([secOff.hosts, secOff.products, secOff.findings], [[], [], []]);
  console.log('✔ ClickHouse not configured: both routes answer DATA_UNAVAILABLE with empty arrays.');

  // ---------------------------------------------------------------- fake ClickHouse
  let dbRows = DB_ROWS;
  let cveRows = CVE_ROWS;
  const ch = await startFakeClickHouse((sql) => {
    if (/FROM cve_findings/.test(sql)) return cveRows;
    if (/FROM metrics\b/.test(sql) && sql.includes('{names:Array(String)}')) return dbRows;
    return [];
  });
  closers.push(() => ch.close());
  process.env.CLICKHOUSE_URL = ch.url;
  process.env.CLICKHOUSE_DATABASE = 'sentinel';

  // ---------------------------------------------------------------- A7
  const dbRes = await getJson('/api/v2/databases/overview?environment=prod');
  assert.strictEqual(dbRes.status, undefined, 'ready payload has no DATA_UNAVAILABLE status');
  assert.strictEqual(dbRes.prototype, false);
  assert.strictEqual(dbRes.environment, 'prod');
  assert.strictEqual(dbRes.databases.length, 3, 'one database per engine/host/db');
  const byEngine = Object.fromEntries(dbRes.databases.map(d => [d.engine, d]));
  assert.deepStrictEqual(Object.keys(byEngine).sort(), ['oracle', 'postgresql', 'sqlserver']);

  const pg = byEngine.postgresql;
  assert.strictEqual(pg.id, 'postgresql:host:pg01/orders');
  assert.strictEqual(pg.host, 'pg01');
  assert.strictEqual(pg.database, 'orders');
  assert.strictEqual(pg.sessions, 12);
  assert.strictEqual(pg.locks, 5, 'lock series summed');
  assert.strictEqual(pg.waits, null, 'no wait metric stored -> null');
  assert.strictEqual(pg.replication_lag, 0.5, 'wal.lag (s) preferred over data_delay (bytes)');
  assert.strictEqual(pg.units.replication_lag, 's');
  assert.strictEqual(pg.size_bytes, 1048576);
  assert.strictEqual(pg.last_seen, new Date(NOW - 30000).toISOString());

  const ora = byEngine.oracle;
  assert.strictEqual(ora.sessions, 42);
  assert.strictEqual(ora.locks, 7);
  assert.strictEqual(ora.size_bytes, 300);
  assert.strictEqual(ora.replication_lag, null);
  assert.strictEqual(ora.waits, null);
  assert.strictEqual(ora.database, null);

  const mss = byEngine.sqlserver;
  assert.strictEqual(mss.sessions, 19, 'underscore-normalised name still mapped');
  assert.strictEqual(mss.locks, 1.5);
  assert.strictEqual(mss.waits, 4.2);
  assert.strictEqual(mss.units.waits, 'ms');
  assert.strictEqual(mss.size_bytes, null);
  assert.strictEqual(mss.replication_lag, null);

  const dbReq = ch.requests.filter(r => /FROM metrics\b/.test(r.sql)).pop();
  assert.ok(dbReq, 'overview query reached ClickHouse');
  assert.ok(dbReq.sql.includes('env = {env:String}'), 'env is a placeholder');
  assert.ok(dbReq.sql.includes('metric_name IN {names:Array(String)}'));
  assert.ok(!/'prod'/.test(dbReq.sql), 'env value is not interpolated into SQL');
  assert.strictEqual(dbReq.params.param_env, 'prod');
  for (const def of DB_RECEIVER_METRICS) {
    assert.ok(dbReq.params.param_names.includes(`'${def.metric}'`), `names param carries ${def.metric}`);
  }
  assert.strictEqual(dbReq.params.param_window, '15');
  console.log('✔ A7: receiver rows shaped per database (postgresql, oracle, sqlserver), missing fields null, SQL parameterised.');

  dbRows = [];
  const dbEmpty = await getJson('/api/v2/databases/overview?environment=staging');
  assert.strictEqual(dbEmpty.status, 'DATA_UNAVAILABLE');
  assert.strictEqual(dbEmpty.environment, 'staging');
  assert.strictEqual(dbEmpty.prototype, false);
  assert.deepStrictEqual(dbEmpty.databases, []);
  assert.ok(dbEmpty.reason);
  dbRows = [{ entity_id: 'host:x', component: 'x', db_name: '', metric_name: 'cpu', series: '{}', value: 1, last_ms: NOW }];
  const dbOnlyOther = await getJson('/api/v2/databases/overview?environment=staging');
  assert.strictEqual(dbOnlyOther.status, 'DATA_UNAVAILABLE', 'non-database rows never become a database');
  console.log('✔ A7: no receiver rows -> DATA_UNAVAILABLE with empty databases.');

  // ---------------------------------------------------------------- A8
  const sec = await getJson('/api/v2/security/summary?environment=prod&days=500');
  assert.strictEqual(sec.status, undefined);
  assert.strictEqual(sec.environment, 'prod');
  assert.strictEqual(sec.days, 90, 'days clamped to 90');
  const hostMap = Object.fromEntries(sec.hosts.map(h => [h.host, h]));
  assert.deepStrictEqual(Object.keys(hostMap).sort(), ['bb-node-01', 'bb-node-02', 'jira-01']);
  assert.deepStrictEqual(hostMap['bb-node-01'], {
    host: 'bb-node-01', product_id: 'bitbucket', critical: 1, high: 1, medium: 1, low: 0, eol_components: 1,
    last_scan: new Date(NOW - 3600000).toISOString()
  });
  assert.deepStrictEqual(
    [hostMap['bb-node-02'].critical, hostMap['bb-node-02'].high, hostMap['bb-node-02'].eol_components],
    [1, 0, 0]
  );
  assert.deepStrictEqual(
    [hostMap['jira-01'].critical, hostMap['jira-01'].high, hostMap['jira-01'].low, hostMap['jira-01'].eol_components],
    [0, 0, 1, 1]
  );
  assert.deepStrictEqual(sec.products, [
    { product_id: 'bitbucket', critical: 2, high: 1, eol_components: 1, hosts: 2 },
    { product_id: 'jira', critical: 0, high: 0, eol_components: 1, hosts: 1 }
  ]);
  assert.strictEqual(sec.findings.length, 3, 'only stored critical/high rows');
  assert.deepStrictEqual(sec.findings.map(f => [f.severity, f.host, f.cve_id]), [
    ['CRITICAL', 'bb-node-01', 'CVE-2026-0001'],
    ['CRITICAL', 'bb-node-02', 'CVE-2026-0001'],
    ['HIGH', 'bb-node-01', 'CVE-2026-0002']
  ]);
  assert.strictEqual(sec.findings[2].is_eol, true);

  const secReq = ch.requests.filter(r => /FROM cve_findings/.test(r.sql)).pop();
  assert.ok(secReq.sql.includes('env = {env:String}'));
  assert.ok(secReq.sql.includes('{days:UInt16}'));
  assert.ok(!/'prod'/.test(secReq.sql), 'env value is not interpolated into SQL');
  assert.strictEqual(secReq.params.param_env, 'prod');
  assert.strictEqual(secReq.params.param_days, '90');
  console.log('✔ A8: per-host / per-product counts match the stored rows exactly; SQL parameterised; days clamped.');

  const secDefault = await getJson('/api/v2/security/summary?environment=staging&limit=1');
  assert.strictEqual(secDefault.days, 7);
  assert.strictEqual(secDefault.findings.length, 1, 'limit applies to findings');
  assert.strictEqual(ch.requests.filter(r => /FROM cve_findings/.test(r.sql)).pop().params.param_env, 'staging');

  cveRows = [];
  const secEmpty = await getJson('/api/v2/security/summary?environment=staging');
  assert.strictEqual(secEmpty.status, 'DATA_UNAVAILABLE');
  assert.deepStrictEqual([secEmpty.hosts, secEmpty.products, secEmpty.findings], [[], [], []]);
  assert.ok(secEmpty.reason);
  console.log('✔ A8: no stored findings -> DATA_UNAVAILABLE with empty arrays.');

  // ---------------------------------------------------------------- errors
  const failing = await startFakeClickHouse(() => ({ status: 500, text: 'Code: 60. Table missing' }));
  closers.push(() => failing.close());
  process.env.CLICKHOUSE_URL = failing.url;
  const dbErr = await getJson('/api/v2/databases/overview?environment=staging');
  assert.strictEqual(dbErr.status, 'DATA_UNAVAILABLE');
  assert.ok(/Failed to query/.test(dbErr.reason));
  const secErr = await getJson('/api/v2/security/summary?environment=staging');
  assert.strictEqual(secErr.status, 'DATA_UNAVAILABLE');
  assert.ok(/Failed to query/.test(secErr.reason));
  process.env.CLICKHOUSE_URL = '';
  console.log('✔ ClickHouse errors -> DATA_UNAVAILABLE with the reason.');

  console.log('=== PHASE A DATABASE & SECURITY TESTS PASSED ===');
}

run()
  .then(async () => { for (const c of closers) { try { await c(); } catch (_) {} } process.exit(0); })
  .catch(async (err) => {
    console.error('✘ Phase A db/security test failed:', err);
    for (const c of closers) { try { await c(); } catch (_) {} }
    process.exit(1);
  });
