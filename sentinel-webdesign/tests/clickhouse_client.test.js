/**
 * Test: ClickHouse client (inert without CLICKHOUSE_URL, query and insert behaviour).
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MIGRATE = path.join(ROOT, 'scripts', 'clickhouse_migrate.js');

// Fake ClickHouse HTTP interface: records every request, answers from `responder`.
function startFakeClickHouse(responder) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const entry = { method: req.method, url, headers: req.headers, body };
      requests.push(entry);
      const { status = 200, text = '' } = responder(entry) || {};
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(text);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function sqlOf(r) { return r.url.searchParams.get('query') || r.body; }

function runNode(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const killer = setTimeout(() => child.kill(), 20000);
    child.on('close', code => { clearTimeout(killer); resolve({ code, out, err }); });
  });
}

async function run() {
  console.log('=== RUNNING CLICKHOUSE CLIENT TESTS ===');
  const servers = [];
  try {
    // 1. Inert when the URL is blank, with no network attempted.
    process.env.CLICKHOUSE_URL = '';
    delete require.cache[require.resolve('../database/clickhouse')];
    const ch = require('../database/clickhouse');
    assert.strictEqual(ch.isConfigured(), false, 'blank URL must be unconfigured');
    assert.strictEqual(await ch.ping(), false);
    assert.strictEqual(ch.getStatus().configured, false);
    await assert.rejects(() => ch.query('SELECT 1'), /not configured/);
    console.log('  [PASS] isConfigured() is false and the client is inert when CLICKHOUSE_URL is blank');

    // 2. Fake server.
    const fake = await startFakeClickHouse(r => {
      const sql = sqlOf(r);
      if (/^SELECT 1$/.test(sql.trim())) return { text: '1\n' };
      if (/FROM metrics_1h/.test(sql)) {
        return { text: JSON.stringify({ bucket: '2026-10-11 10:00:00', env: 'prod', component: 'bitbucket', entity_id: 'host:a', metric_name: 'cpu', source: 'otel', value: 41.5 }) + '\n' };
      }
      if (/FROM metrics_1m/.test(sql)) {
        return { text: JSON.stringify({ bucket: '2026-10-11 10:00:00', env: 'prod', component: 'bitbucket', entity_id: 'host:a', metric_name: 'cpu', source: 'otel', value: 41.5 }) + '\n' };
      }
      if (/FROM metrics/.test(sql)) {
        return { text: [
          { bucket: '2026-10-11 10:00:00.000', env: 'prod', component: 'bitbucket', entity_id: 'host:a', metric_name: 'cpu', source: 'otel', value: 40 },
          { bucket: '2026-10-11 10:00:10.500', env: 'prod', component: 'bitbucket', entity_id: 'host:a', metric_name: 'cpu', source: 'otel', value: 43 },
        ].map(o => JSON.stringify(o)).join('\n') + '\n' };
      }
      if (/FROM schema_migrations/.test(sql)) return { text: '' };
      if (/BOOM/.test(sql)) return { status: 500, text: 'Code: 62. DB::Exception: Syntax error BOOM' };
      return { text: '' };
    });
    servers.push(fake.server);
    process.env.CLICKHOUSE_URL = fake.url;
    process.env.CLICKHOUSE_USER = 'sentinel_writer';
    process.env.CLICKHOUSE_PASSWORD = 'test-password';
    process.env.CLICKHOUSE_DATABASE = 'sentinel';
    assert.strictEqual(ch.isConfigured(), true);
    assert.strictEqual(await ch.ping(), true);
    console.log('  [PASS] isConfigured()/ping() against the fake server');

    // 3. insertMetrics posts JSONEachRow with the right columns, drops non-numeric values.
    fake.requests.length = 0;
    const inserted = await ch.insertMetrics([
      { timestamp: '2026-10-11T10:00:00.123Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'cpu', value: 42.5, env: 'prod', source: 'otel', attributes: { region: 'eu', port: 443, skip: null } },
      { timestamp: '2026-10-11T10:00:01.000Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'status', value: 'Data Not Available', env: 'prod' },
      { timestamp: '2026-10-11T10:00:02.000Z', component: 'jira', entity_id: 'app:jira', metricName: 'latency', value: '12.5', env: 'staging' },
      { timestamp: '2026-10-11T10:00:03.000Z', component: 'jira', metricName: 'latency', value: null, env: 'staging' },
      { timestamp: '2026-10-11T10:00:04.000Z', component: 'jira', metricName: 'latency', value: NaN, env: 'staging' },
    ]);
    assert.strictEqual(inserted, 2, 'only the two numeric entries are inserted');
    assert.strictEqual(fake.requests.length, 1);
    const ins = fake.requests[0];
    assert.strictEqual(ins.method, 'POST');
    assert.strictEqual(ins.url.searchParams.get('query'), 'INSERT INTO metrics FORMAT JSONEachRow');
    assert.strictEqual(ins.url.searchParams.get('database'), 'sentinel');
    assert.strictEqual(ins.headers['x-clickhouse-user'], 'sentinel_writer');
    assert.strictEqual(ins.headers['x-clickhouse-key'], 'test-password');
    assert.ok(!ins.url.search.includes('test-password'), 'password must never be in the URL');
    const lines = ins.body.trim().split('\n').map(l => JSON.parse(l));
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(Object.keys(lines[0]).sort(),
      ['attributes', 'component', 'entity_id', 'env', 'metric_name', 'source', 'ts', 'value']);
    assert.deepStrictEqual(lines[0], {
      ts: '2026-10-11 10:00:00.123', env: 'prod', component: 'bitbucket', entity_id: 'host:a',
      metric_name: 'cpu', value: 42.5, source: 'otel', attributes: { region: 'eu', port: '443' },
    });
    assert.strictEqual(lines[1].value, 12.5);
    assert.strictEqual(lines[1].source, 'collector', 'default source is collector');
    assert.ok(!ins.body.includes('Data Not Available'));
    assert.strictEqual(ch.getStatus().rowsInserted, 2);
    assert.ok(ch.getStatus().lastInsertAt);
    assert.strictEqual(await ch.insertMetrics([]), 0);
    console.log('  [PASS] insertMetrics posts JSONEachRow with correct columns and drops non-numeric values');

    // 4. insertLogs / insertSpans.
    fake.requests.length = 0;
    assert.strictEqual(await ch.insertLogs([
      { timestamp: '2026-10-11T10:00:00Z', env: 'prod', app_id: 'jira', entity_id: 'host:b', level: 'error', message: 'boom', traceId: 'abc', fields: { k: 'v' } },
      { timestamp: '2026-10-11T10:00:00Z', app_id: 'jira', message: 'no env -> skipped' },
    ]), 1);
    assert.strictEqual(fake.requests[0].url.searchParams.get('query'), 'INSERT INTO logs FORMAT JSONEachRow');
    const logRow = JSON.parse(fake.requests[0].body.trim());
    assert.strictEqual(logRow.level, 'ERROR');
    assert.strictEqual(logRow.trace_id, 'abc');
    assert.strictEqual(await ch.insertSpans([
      { trace_id: 't1', span_id: 's1', name: 'login', service: 'journey', env: 'prod', start_ts: Date.UTC(2026, 9, 11, 10), duration_ms: 120.5, status: 'OK' },
      { trace_id: 't1', span_id: 's2', name: 'bad', service: 'journey', env: 'prod', start_ts: Date.UTC(2026, 9, 11, 10), duration_ms: 'n/a' },
    ]), 1);
    const spanRow = JSON.parse(fake.requests[1].body.trim());
    assert.strictEqual(fake.requests[1].url.searchParams.get('query'), 'INSERT INTO spans FORMAT JSONEachRow');
    assert.strictEqual(spanRow.start_ts, '2026-10-11 10:00:00.000');
    assert.strictEqual(spanRow.parent_span_id, '');
    console.log('  [PASS] insertLogs / insertSpans map and filter rows');

    // 5. queryMetrics sends parameters, never interpolated values, and maps rows back.
    fake.requests.length = 0;
    const evil = "cpu' OR 1=1 --";
    const raw = await ch.queryMetrics({ component: 'bitbucket', metricName: evil, env: 'prod', sinceMs: 1000, untilMs: 2000, limit: 50 });
    const q = fake.requests[0];
    assert.ok(/FROM metrics\b/.test(q.body) && !/metrics_1m/.test(q.body));
    assert.ok(!q.body.includes(evil) && !q.body.includes('bitbucket') && !q.body.includes("'prod'"), 'values must not be interpolated into SQL');
    assert.ok(q.body.includes('{metricName:String}') && q.body.includes('{env:String}') && q.body.includes('{component:String}'));
    assert.strictEqual(q.url.searchParams.get('param_metricName'), evil);
    assert.strictEqual(q.url.searchParams.get('param_env'), 'prod');
    assert.strictEqual(q.url.searchParams.get('param_component'), 'bitbucket');
    assert.strictEqual(q.url.searchParams.get('param_since'), '1000');
    assert.strictEqual(q.url.searchParams.get('param_until'), '2000');
    assert.strictEqual(q.url.searchParams.get('param_limit'), '50');
    assert.strictEqual(q.url.searchParams.get('default_format'), 'JSONEachRow');
    assert.deepStrictEqual(raw, [
      { timestamp: '2026-10-11T10:00:00.000Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'cpu', value: 40, env: 'prod', source: 'otel' },
      { timestamp: '2026-10-11T10:00:10.500Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'cpu', value: 43, env: 'prod', source: 'otel' },
    ]);

    fake.requests.length = 0;
    const rolled = await ch.queryMetrics({ component: 'bitbucket', env: 'prod', stepSeconds: 300 });
    assert.ok(/FROM metrics_1m/.test(fake.requests[0].body) && /avgMerge\(value_avg\)/.test(fake.requests[0].body));
    assert.strictEqual(fake.requests[0].url.searchParams.get('param_step'), '300');
    assert.strictEqual(fake.requests[0].url.searchParams.get('param_metricName'), null);
    assert.deepStrictEqual(rolled, [{ timestamp: '2026-10-11T10:00:00.000Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'cpu', value: 41.5, env: 'prod', source: 'otel' }]);

    fake.requests.length = 0;
    const rolled1h = await ch.queryMetrics({ component: 'bitbucket', env: 'prod', stepSeconds: 3600 });
    assert.ok(/FROM metrics_1h/.test(fake.requests[0].body) && /avgMerge\(value_avg\)/.test(fake.requests[0].body));
    assert.strictEqual(fake.requests[0].url.searchParams.get('param_step'), '3600');
    assert.deepStrictEqual(rolled1h, [{ timestamp: '2026-10-11T10:00:00.000Z', component: 'bitbucket', entity_id: 'host:a', metricName: 'cpu', value: 41.5, env: 'prod', source: 'otel' }]);

    await assert.rejects(() => ch.queryMetrics({ component: 'bitbucket' }), /requires env/);
    console.log('  [PASS] queryMetrics uses {name:Type} parameters and maps rows to in-memory shape (raw + 1m + 1h rollups)');

    // 6. HTTP errors surface the body text and land in getStatus().
    await assert.rejects(() => ch.query('SELECT BOOM'), /HTTP 500: Code: 62\. DB::Exception: Syntax error BOOM/);
    assert.ok(/Syntax error BOOM/.test(ch.getStatus().lastError));
    console.log('  [PASS] errors carry the HTTP body text and are recorded in getStatus()');

    // 7. Timeout via AbortController.
    const hang = http.createServer(() => { /* never answers */ });
    await new Promise(r => hang.listen(0, '127.0.0.1', r));
    servers.push(hang);
    process.env.CLICKHOUSE_URL = `http://127.0.0.1:${hang.address().port}`;
    process.env.CLICKHOUSE_TIMEOUT_MS = '200';
    await assert.rejects(() => ch.query('SELECT 1'), /timed out after 200ms/);
    delete process.env.CLICKHOUSE_TIMEOUT_MS;
    hang.closeAllConnections();
    console.log('  [PASS] requests time out via AbortController');

    // 8. Migration script: dry-run (no ClickHouse configured) and a real run against the fake.
    const baseEnv = { ...process.env };
    delete baseEnv.CLICKHOUSE_PASSWORD;
    const dry = spawnSync(process.execPath, [MIGRATE, '--dry-run'], { cwd: ROOT, env: { ...baseEnv, CLICKHOUSE_URL: '' }, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(dry.status, 0, dry.stderr);
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.metrics'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.metrics_1m'));
    assert.ok(dry.stdout.includes('CREATE MATERIALIZED VIEW IF NOT EXISTS sentinel.metrics_1m_mv'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.logs'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.spans'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.events'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.change_points'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.agent_inventory'));
    assert.ok(dry.stdout.includes('CREATE TABLE IF NOT EXISTS sentinel.metrics_1h'));
    assert.ok(dry.stdout.includes('CREATE MATERIALIZED VIEW IF NOT EXISTS sentinel.metrics_1h_mv'));
    assert.ok(dry.stdout.includes('sentinel.schema_migrations'));
    assert.ok(!dry.stdout.includes('{db}'), 'placeholder must be substituted');

    const inert = spawnSync(process.execPath, [MIGRATE], { cwd: ROOT, env: { ...baseEnv, CLICKHOUSE_URL: '' }, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(inert.status, 0);
    assert.ok(/not configured/.test(inert.stdout));

    fake.requests.length = 0;
    const live = await runNode([MIGRATE], { ...baseEnv, CLICKHOUSE_URL: fake.url });
    assert.strictEqual(live.code, 0, live.err);
    const sqls = fake.requests.map(sqlOf);
    assert.ok(sqls[0].startsWith('CREATE DATABASE IF NOT EXISTS sentinel'));
    assert.strictEqual(fake.requests[0].url.searchParams.get('database'), null, 'CREATE DATABASE runs without a database param');
    const recorded = fake.requests.filter(r => /INSERT INTO schema_migrations/.test(sqlOf(r)));
    assert.ok(recorded.length >= 3, 'one schema_migrations row per migration');
    assert.ok(recorded.every(r => r.url.searchParams.get('param_checksum').length === 64));
    assert.deepStrictEqual(recorded.slice(0, 3).map(r => r.url.searchParams.get('param_version')), ['1', '2', '3']);
    // 9. logStore writes to ClickHouse and searchLogs reads from ClickHouse.
    process.env.CLICKHOUSE_URL = fake.url;
    const logStore = require('../database/log_store');
    fake.requests.length = 0;
    await logStore.appendLogs([
      { ts: '2026-10-11T12:00:00.000Z', app_id: 'bitbucket', environment: 'prod', level: 'WARN', message: 'disk almost full', fields: { host: 'node-1' } }
    ]);
    assert.strictEqual(fake.requests.length, 1);
    assert.strictEqual(fake.requests[0].url.searchParams.get('query'), 'INSERT INTO logs FORMAT JSONEachRow');
    const chLogRow = JSON.parse(fake.requests[0].body.trim());
    assert.strictEqual(chLogRow.app_id, 'bitbucket');
    assert.strictEqual(chLogRow.level, 'WARN');
    assert.strictEqual(chLogRow.message, 'disk almost full');

    fake.requests.length = 0;
    const searchRes = await logStore.searchLogs({
      from: '2026-10-11T11:00:00.000Z',
      to: '2026-10-11T13:00:00.000Z',
      environment: 'prod',
      app_id: 'bitbucket',
      q: 'disk'
    });
    assert.strictEqual(fake.requests.length, 1);
    const searchReq = fake.requests[0];
    assert.ok(/FROM logs/.test(searchReq.body));
    assert.ok(searchReq.body.includes('{fromMs:Int64}') && searchReq.body.includes('{toMs:Int64}') && searchReq.body.includes('{env:String}'));
    assert.strictEqual(searchReq.url.searchParams.get('param_env'), 'prod');
    assert.strictEqual(searchReq.url.searchParams.get('param_app_id'), 'bitbucket');
    assert.strictEqual(searchReq.url.searchParams.get('param_qLike'), '%disk%');
    assert.strictEqual(searchRes.source, 'clickhouse');
    console.log('  [PASS] logStore appends to ClickHouse and searchLogs runs parameterised queries');

    console.log('\nALL CLICKHOUSE CLIENT TESTS PASSED');
  } finally {
    for (const s of servers) {
      if (s.closeAllConnections) s.closeAllConnections();
      await new Promise(r => s.close(r));
    }
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error('[FAIL]', err && err.stack ? err.stack : err);
  process.exit(1);
});
