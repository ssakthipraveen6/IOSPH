/**
 * tests/phase_u_product.test.js
 *
 * Phase U acceptance for U1: the Product page reads ClickHouse, so every node
 * answers the same.
 *  - GET /api/products/:id/journeys sends parameterised SQL over `spans`
 *    (env from the session, product as `service`, range bounds as Int64 ms),
 *    computes p95 in ClickHouse with quantile(0.95), lists the last 10 failed
 *    runs, and reads the journey.success trend through queryMetrics with a
 *    stepSeconds bucket (metrics_1m / metrics_1h rollups).
 *  - With ClickHouse blank, empty or failing the answer is DATA_UNAVAILABLE
 *    with null telemetry: never a synthetic 100% / 0 ms.
 *  - GET /api/products/:id/runs reads root spans plus their step spans.
 *  - The in-memory runner's getJourneyStats no longer reports 100% for no data.
 */
'use strict';

process.env.SENTINEL_JOBS_QUIET = 'true';
process.env.SENTINEL_ALLOW_LOCALHOST_CORS = 'true';
process.env.CLICKHOUSE_URL = '';

const assert = require('assert');
const session = require('../backend/auth/session');
session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');

const yamlConfig = require('../backend/config/yaml_config');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const { app } = require('../backend/server');
const { JourneyRunner } = require('../synthetics/runner');

const closers = [];
const HOUR = 3600 * 1000;
const FROM = Date.UTC(2026, 9, 11, 0, 0, 0);
const TO = Date.UTC(2026, 9, 12, 0, 0, 0);

function token(username, role, environment) {
  return session.generateToken({ username, role, environment });
}

async function run() {
  console.log('=== PHASE U1: PRODUCT PAGE FROM CLICKHOUSE ===');

  // A product with at least one journey of at least two steps, read from the manifests.
  const apps = yamlConfig.loadAllApplications() || {};
  const product = Object.values(apps).find(a => a && Array.isArray(a.journeys)
    && a.journeys.some(j => Array.isArray(j.steps) && j.steps.length >= 2));
  assert.ok(product, 'a manifest with a multi-step journey exists');
  const PID = product.id;
  const J = product.journeys.find(j => j.steps && j.steps.length >= 2);
  const [S1, S2] = J.steps;

  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  closers.push(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const prodToken = token('sre.prod@enterprise.corp', 'SRE Lead', 'prod');
  const get = async (p, bearer, expect = 200) => {
    const r = await fetch(base + p, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    assert.strictEqual(r.status, expect, `${p} -> HTTP ${r.status}`);
    return r.json();
  };

  // ---------------------------------------------------------------- not configured
  const off = await get(`/api/products/${PID}/journeys?environment=staging`);
  assert.strictEqual(off.status, 'DATA_UNAVAILABLE');
  assert.ok(/not configured/i.test(off.reason));
  assert.strictEqual(off.environment, 'staging');
  assert.deepStrictEqual(off.summary, { runs: null, failures: null, success_rate: null, p50_ms: null, p95_ms: null, last_run_ts: null });
  assert.deepStrictEqual(off.failures, []);
  assert.deepStrictEqual(off.trend.points, []);
  assert.strictEqual(off.journeys.length, product.journeys.length, 'manifest definitions still listed');
  for (const j of off.journeys) {
    assert.deepStrictEqual([j.runs, j.success_rate, j.p95_latency_ms, j.last_run_ts, j.last_status], [null, null, null, null, 'UNKNOWN']);
    for (const s of j.steps) assert.deepStrictEqual([s.success_rate, s.p95_latency_ms], [null, null]);
  }
  const runsOff = await get(`/api/products/${PID}/runs?environment=staging`);
  assert.strictEqual(runsOff.status, 'DATA_UNAVAILABLE');
  assert.deepStrictEqual(runsOff.runs, []);
  await get('/api/products/no_such_product_u1/journeys', null, 404);
  console.log('✔ ClickHouse blank: DATA_UNAVAILABLE, null telemetry, manifest journeys listed, unknown product 404.');

  // ---------------------------------------------------------------- fake ClickHouse
  const failures = Array.from({ length: 10 }, (_, i) => ({
    trace_id: `trace${String(i).padStart(2, '0')}`,
    name: J.name,
    journey_id: J.id,
    step_id: S2.id,
    error: `HTTP 503 on attempt ${i}`,
    duration_ms: 1200.4 + i,
    ts_ms: TO - (i + 1) * 60000
  }));
  let summaryRows = [{ runs: 40, failures: 10, p50_ms: 410.2, p95_ms: 1873.6, last_run_ms: TO - 60000 }];
  const ch = await startFakeClickHouse((sql) => {
    if (/FROM sentinel\.spans/.test(sql)) {
      if (/GROUP BY journey_id, step_id/.test(sql)) {
        return [
          { journey_id: J.id, step_id: S1.id, executed: 40, ok: 40, p95_ms: 120.4 },
          { journey_id: J.id, step_id: S2.id, executed: 40, ok: 30, p95_ms: 1650.6 }
        ];
      }
      if (/GROUP BY journey_id/.test(sql)) {
        return [{ journey_id: J.id, runs: 40, failures: 10, p50_ms: 410.2, p95_ms: 1873.6, last_run_ms: TO - 60000, last_status: 'ERROR' }];
      }
      if (/status = 'ERROR'\s+ORDER BY start_ts DESC/.test(sql)) return failures;
      if (/trace_id IN/.test(sql)) {
        return [
          { trace_id: 'trace00', step_id: S1.id, layer: S1.layer || 'app', error: '', status: 'OK', duration_ms: 100.2, ts_ms: TO - 60000 },
          { trace_id: 'trace00', step_id: S2.id, layer: S2.layer || 'app', error: 'HTTP 503', status: 'ERROR', duration_ms: 1100.7, ts_ms: TO - 59900 }
        ];
      }
      if (/ORDER BY start_ts DESC/.test(sql)) {
        return [{ trace_id: 'trace00', name: J.name, journey_id: J.id, error: 'HTTP 503', status: 'ERROR', duration_ms: 1201.4, ts_ms: TO - 60000 }];
      }
      return summaryRows;
    }
    if (/FROM metrics_1m|FROM metrics_1h/.test(sql)) {
      return [
        { bucket: '2026-10-11 00:00:00', env: 'prod', component: PID, entity_id: '', metric_name: 'journey.success', source: 'probe', value: 1 },
        { bucket: '2026-10-11 00:15:00', env: 'prod', component: PID, entity_id: '', metric_name: 'journey.success', source: 'probe', value: 0.75 }
      ];
    }
    return [];
  });
  closers.push(() => ch.close());
  process.env.CLICKHOUSE_URL = ch.url;
  process.env.CLICKHOUSE_DATABASE = 'sentinel';

  // Environment comes from the session (prod token, no query parameter).
  const res = await get(`/api/products/${PID}/journeys?from=${new Date(FROM).toISOString()}&to=${TO}`, prodToken);
  assert.strictEqual(res.status, undefined, 'ready payload carries no DATA_UNAVAILABLE status');
  assert.strictEqual(res.environment, 'prod');
  assert.strictEqual(res.product_id, PID);
  assert.strictEqual(res.source, 'clickhouse');
  assert.deepStrictEqual(res.range, { from: new Date(FROM).toISOString(), to: new Date(TO).toISOString() });
  assert.deepStrictEqual(res.summary, {
    runs: 40, failures: 10, success_rate: 75, p50_ms: 410, p95_ms: 1874, last_run_ts: new Date(TO - 60000).toISOString()
  });

  const jr = res.journeys.find(j => j.id === J.id);
  assert.strictEqual(jr.p95_latency_ms, 1874, 'journey p95 is the ClickHouse quantile, not the last run');
  assert.strictEqual(jr.success_rate, 75);
  assert.strictEqual(jr.last_status, 'FAILED');
  assert.strictEqual(jr.last_run_ts, new Date(TO - 60000).toISOString());
  const st1 = jr.steps.find(s => s.id === S1.id);
  const st2 = jr.steps.find(s => s.id === S2.id);
  assert.deepStrictEqual([st1.p95_latency_ms, st1.success_rate], [120, 100]);
  assert.deepStrictEqual([st2.p95_latency_ms, st2.success_rate], [1651, 75]);
  for (const other of res.journeys.filter(j => j.id !== J.id)) {
    assert.deepStrictEqual([other.runs, other.p95_latency_ms, other.success_rate, other.last_status], [null, null, null, 'UNKNOWN'],
      'a journey with no spans stays null');
  }

  assert.strictEqual(res.failures.length, 10, 'last 10 failures');
  assert.deepStrictEqual(res.failures[0], {
    trace_id: 'trace00',
    journey_id: J.id,
    journey_name: J.name || J.id,
    step_id: S2.id,
    step_name: S2.name || S2.id,
    ts: new Date(TO - 60000).toISOString(),
    duration_ms: 1200,
    error: 'HTTP 503 on attempt 0'
  });
  assert.deepStrictEqual(res.failures.map(f => f.trace_id), failures.map(f => f.trace_id), 'newest first, as returned');

  assert.strictEqual(res.trend.metric, 'journey.success');
  assert.strictEqual(res.trend.step_seconds, 900, '24h range -> 15 min buckets');
  assert.deepStrictEqual(res.trend.points, [
    { ts: '2026-10-11T00:00:00.000Z', success_rate: 100 },
    { ts: '2026-10-11T00:15:00.000Z', success_rate: 75 }
  ]);

  // ---- the SQL that reached ClickHouse
  const spanReqs = ch.requests.filter(r => /FROM sentinel\.spans/.test(r.sql));
  assert.strictEqual(spanReqs.length, 4, 'summary, per journey, per step, failures');
  for (const r of spanReqs) {
    assert.ok(r.sql.includes('env = {env:String}'), 'env is a placeholder');
    assert.ok(r.sql.includes('service = {service:String}'));
    assert.ok(r.sql.includes("start_ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')"));
    assert.ok(r.sql.includes("start_ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')"));
    assert.ok(!/'prod'/.test(r.sql) && !r.sql.includes(PID), 'no value interpolated into SQL');
    assert.strictEqual(r.params.param_env, 'prod', 'env from the session');
    assert.strictEqual(r.params.param_service, PID);
    assert.strictEqual(r.params.param_from, String(FROM));
    assert.strictEqual(r.params.param_to, String(TO));
    assert.strictEqual(r.url.searchParams.get('database'), 'sentinel');
  }
  const summaryReq = spanReqs.find(r => !/GROUP BY/.test(r.sql) && !/ORDER BY/.test(r.sql));
  assert.ok(/quantile\(0\.95\)\(duration_ms\) AS p95_ms/.test(summaryReq.sql), 'p95 computed by ClickHouse');
  assert.ok(summaryReq.sql.includes("parent_span_id = ''"), 'summary over journey root spans');
  assert.ok(!/avg\(/i.test(summaryReq.sql), 'no average standing in for p95');
  const journeyReq = spanReqs.find(r => /GROUP BY journey_id$/m.test(r.sql));
  assert.ok(/quantile\(0\.95\)\(duration_ms\)/.test(journeyReq.sql));
  const stepReq = spanReqs.find(r => /GROUP BY journey_id, step_id/.test(r.sql));
  assert.ok(/quantileIf\(0\.95\)\(duration_ms, status != 'SKIPPED'\)/.test(stepReq.sql), 'skipped steps excluded from step p95');
  const failReq = spanReqs.find(r => /status = 'ERROR'\s+ORDER BY start_ts DESC/.test(r.sql));
  assert.ok(failReq.sql.includes('LIMIT {limit:UInt32}'));
  assert.strictEqual(failReq.params.param_limit, '10');
  assert.ok(/trace_id/.test(failReq.sql) && /attributes\['error'\]/.test(failReq.sql));

  const trendReq = ch.requests.find(r => /FROM metrics_1m/.test(r.sql));
  assert.ok(trendReq, 'trend read through queryMetrics from the metrics_1m rollup');
  assert.strictEqual(trendReq.params.param_step, '900');
  assert.strictEqual(trendReq.params.param_env, 'prod');
  assert.strictEqual(trendReq.params.param_component, PID);
  assert.strictEqual(trendReq.params.param_metricName, 'journey.success');
  assert.strictEqual(trendReq.params.param_since, String(FROM));
  assert.strictEqual(trendReq.params.param_until, String(TO));
  console.log('✔ journeys: p95 via quantile(0.95) over the range, env from the session, range bounds parameterised, last 10 failures, queryMetrics trend.');

  // ---- default range (last 24h) and a 7-day range picks the hourly rollup
  ch.requests.length = 0;
  const before = Date.now();
  const def = await get(`/api/products/${PID}/journeys?environment=staging`);
  const after = Date.now();
  const defReq = ch.requests.find(r => /FROM sentinel\.spans/.test(r.sql));
  const to = Number(defReq.params.param_to);
  assert.ok(to >= before && to <= after, 'default "to" is now');
  assert.strictEqual(to - Number(defReq.params.param_from), 24 * HOUR, 'default range is 24h');
  assert.strictEqual(defReq.params.param_env, 'staging');
  assert.strictEqual(def.environment, 'staging');

  ch.requests.length = 0;
  const week = await get(`/api/products/${PID}/journeys?environment=staging&from=${TO - 7 * 24 * HOUR}&to=${TO}`);
  assert.strictEqual(week.trend.step_seconds, 6 * 3600);
  assert.ok(ch.requests.some(r => /FROM metrics_1h/.test(r.sql)), '>= 1h step reads metrics_1h');
  await get(`/api/products/${PID}/journeys?from=${TO}&to=${FROM}`, null, 400);
  await get(`/api/products/${PID}/journeys?from=yesterday`, null, 400);
  console.log('✔ range: 24h default, hourly rollup for a week, inverted or unparseable bounds -> 400.');

  // ---- runs from spans
  ch.requests.length = 0;
  const runs = await get(`/api/products/${PID}/runs?limit=5`, prodToken);
  assert.strictEqual(runs.count, 1);
  assert.strictEqual(runs.environment, 'prod');
  assert.deepStrictEqual(
    { ...runs.runs[0], steps: undefined },
    { run_id: 'trace00', journey_id: J.id, journey_name: J.name || J.id, environment: 'prod', start_ts: new Date(TO - 60000).toISOString(), duration_ms: 1201, status: 'FAILED', error: 'HTTP 503', steps: undefined }
  );
  assert.deepStrictEqual(runs.runs[0].steps.map(s => [s.step_id, s.status, s.duration_ms, s.error]), [
    [S1.id, 'PASSED', 100, null],
    [S2.id, 'ERROR', 1101, 'HTTP 503']
  ]);
  const rootReq = ch.requests.find(r => /ORDER BY start_ts DESC/.test(r.sql));
  assert.strictEqual(rootReq.params.param_limit, '5');
  assert.strictEqual(rootReq.params.param_env, 'prod');
  const stepsReq = ch.requests.find(r => /trace_id IN \{traces:Array\(String\)\}/.test(r.sql));
  assert.strictEqual(stepsReq.params.param_traces, "['trace00']");
  console.log('✔ runs: root spans + step spans from ClickHouse, env from the session.');

  // ---------------------------------------------------------------- empty ClickHouse
  summaryRows = [{ runs: 0, failures: 0, p50_ms: null, p95_ms: null, last_run_ms: 0 }];
  const empty = await get(`/api/products/${PID}/journeys?environment=staging`);
  assert.strictEqual(empty.status, 'DATA_UNAVAILABLE');
  assert.ok(/No journey spans stored/.test(empty.reason));
  assert.deepStrictEqual(empty.summary, { runs: null, failures: null, success_rate: null, p50_ms: null, p95_ms: null, last_run_ts: null });
  assert.deepStrictEqual(empty.failures, []);
  summaryRows = [];
  const blank = await get(`/api/products/${PID}/journeys?environment=staging`);
  assert.strictEqual(blank.status, 'DATA_UNAVAILABLE', 'no rows at all -> DATA_UNAVAILABLE');
  assert.strictEqual(blank.summary.success_rate, null, 'never a fabricated 100%');
  console.log('✔ ClickHouse empty: DATA_UNAVAILABLE with nulls, no synthetic success rate.');

  // ---------------------------------------------------------------- ClickHouse error
  const failing = await startFakeClickHouse(() => ({ status: 500, text: 'Code: 60. Table sentinel.spans does not exist' }));
  closers.push(() => failing.close());
  process.env.CLICKHOUSE_URL = failing.url;
  const err = await get(`/api/products/${PID}/journeys?environment=staging`);
  assert.strictEqual(err.status, 'DATA_UNAVAILABLE');
  assert.ok(/Failed to query journey spans/.test(err.reason));
  const runsErr = await get(`/api/products/${PID}/runs?environment=staging`);
  assert.strictEqual(runsErr.status, 'DATA_UNAVAILABLE');
  process.env.CLICKHOUSE_URL = '';
  console.log('✔ ClickHouse error: DATA_UNAVAILABLE with the reason.');

  // ---------------------------------------------------------------- in-memory runner
  const runner = new JourneyRunner({ clickhouseClient: {}, dbManager: {} });
  const stats = runner.getJourneyStats('nothing', { env: 'staging' });
  assert.strictEqual(stats.successRate, null, 'no runs is not 100% success');
  assert.strictEqual(stats.p95Ms, null);
  assert.strictEqual(stats.status, 'DATA_UNAVAILABLE');
  console.log('✔ getJourneyStats: no runs -> null / DATA_UNAVAILABLE, not 100%.');

  console.log('=== PHASE U1 PRODUCT TESTS PASSED ===');
}

run()
  .then(async () => { for (const c of closers) { try { await c(); } catch (_) {} } process.exit(0); })
  .catch(async (err) => {
    console.error('✘ Phase U1 product test failed:', err);
    for (const c of closers) { try { await c(); } catch (_) {} }
    process.exit(1);
  });
