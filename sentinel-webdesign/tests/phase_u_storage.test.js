/**
 * tests/phase_u_storage.test.js
 *
 * Phase U / U5 acceptance for GET /overview of backend/routes/storageRoutes.js:
 *  - No ClickHouse -> DATA_UNAVAILABLE with empty shares (no query sent).
 *  - SQL is parameterised: env is bound as param_env (never interpolated),
 *    the nas.* names and the storage journey layer are bound parameters.
 *  - Fixture rows are shaped into one record per host + share (up, latest and
 *    p95 per operation, last_seen) and per storage-layer journey step.
 *  - No rows -> DATA_UNAVAILABLE; a failing ClickHouse -> DATA_UNAVAILABLE.
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const storageRoutes = require('../backend/routes/storageRoutes');
const { shapeShares, shapeJourneySteps, buildManifestIndex, NAS_METRICS } = storageRoutes;

const NOW = Date.now();
const HOST = 'nas-client-01.example.test';
const SHARE = '/mnt/example/share-a';
const SHARE_B = '/mnt/example/share-b';

const NAS_ROWS = [
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.up', latest: 1, p95: 1, samples: 12, last_ms: NOW - 20000 },
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.stat_ms', latest: 2.5, p95: 4.123, samples: 12, last_ms: NOW - 20000 },
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.list_ms', latest: 8, p95: 15, samples: 12, last_ms: NOW - 20000 },
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.read_ms', latest: 3, p95: 6, samples: 12, last_ms: NOW - 20000 },
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.write_ms', latest: 11, p95: 40, samples: 12, last_ms: NOW - 10000 },
  // Share B is down: only nas.up was emitted (no latency points when the probe failed).
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE_B, metric_name: 'nas.up', latest: 0, p95: 1, samples: 6, last_ms: NOW - 5000 },
  // Rows to ignore: no share attribute, unknown metric.
  { component: HOST, entity_id: `host:${HOST}`, share: '', metric_name: 'nas.up', latest: 1, p95: 1, samples: 1, last_ms: NOW },
  { component: HOST, entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.other_ms', latest: 1, p95: 1, samples: 1, last_ms: NOW }
];

const JOURNEY_ROWS = [
  { component: 'exampleapp', journey: 'git_ops', step: 'clone', metric_name: 'journey.step.duration_ms', latest: 812.4, p95: 1500.333, mean: 900, samples: 10, last_ms: NOW - 30000 },
  { component: 'exampleapp', journey: 'git_ops', step: 'clone', metric_name: 'journey.success', latest: 0, p95: 1, mean: 0.8, samples: 10, last_ms: NOW - 30000 },
  { component: 'exampleapp', journey: 'artifact_io', step: 'upload', metric_name: 'journey.success', latest: 1, p95: 1, mean: 1, samples: 4, last_ms: NOW - 60000 }
];

const APPS = [
  {
    id: 'exampleapp',
    layers: { hosts: [HOST.toUpperCase()], shares: [`${SHARE}/`] },
    journeys: [{ id: 'git_ops', name: 'Git operations', steps: [{ id: 'clone', name: 'Clone repository', layer: 'storage' }] }]
  },
  { id: 'otherapp', layers: { hosts: ['other-host.example.test'], shares: [SHARE] } }
];

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function main() {
  const closers = [];
  try {
    // ---------------------------------------------------------------- shaping (pure)
    const index = buildManifestIndex(APPS);
    const shares = shapeShares(NAS_ROWS, index);
    assert.strictEqual(shares.length, 2, 'one record per host + share; empty-share rows dropped');
    const [a, b] = shares;
    assert.strictEqual(a.share, SHARE);
    assert.strictEqual(a.host, HOST);
    assert.strictEqual(a.id, `${HOST}:${SHARE}`);
    assert.deepStrictEqual(a.products, ['exampleapp'], 'manifest share owner on this host; other host owner excluded');
    assert.strictEqual(a.up, true);
    assert.strictEqual(a.status, 'UP');
    assert.deepStrictEqual(a.latency.stat, { latest_ms: 2.5, p95_ms: 4.12, samples: 12 });
    assert.deepStrictEqual(a.latency.write, { latest_ms: 11, p95_ms: 40, samples: 12 });
    assert.strictEqual(a.last_seen, new Date(NOW - 10000).toISOString(), 'last_seen is the freshest point');
    assert.strictEqual(b.share, SHARE_B);
    assert.strictEqual(b.status, 'DOWN');
    assert.strictEqual(b.up, false);
    assert.deepStrictEqual(b.products, []);
    assert.deepStrictEqual(b.latency.read, { latest_ms: null, p95_ms: null, samples: 0 }, 'missing op -> null, never filled');
    assert.deepStrictEqual(Object.keys(NAS_METRICS).sort(), ['nas.list_ms', 'nas.read_ms', 'nas.stat_ms', 'nas.up', 'nas.write_ms']);

    // application.id (arrives as component) attributes the share too.
    const withApp = shapeShares([{ component: 'someproduct', entity_id: `host:${HOST}`, share: SHARE, metric_name: 'nas.up', latest: 1, p95: 1, samples: 1, last_ms: NOW }]);
    assert.deepStrictEqual(withApp[0].products, ['someproduct']);
    assert.strictEqual(withApp[0].host, HOST);

    const steps = shapeJourneySteps(JOURNEY_ROWS, index);
    assert.strictEqual(steps.length, 2);
    const clone = steps.find(s => s.step === 'clone');
    assert.strictEqual(clone.product, 'exampleapp');
    assert.strictEqual(clone.journey_name, 'Git operations');
    assert.strictEqual(clone.step_name, 'Clone repository');
    assert.strictEqual(clone.layer, 'storage');
    assert.strictEqual(clone.status, 'FAILED', 'latest journey.success 0 -> FAILED');
    assert.strictEqual(clone.success_rate, 80);
    assert.strictEqual(clone.runs, 10);
    assert.strictEqual(clone.duration_ms, 812.4);
    assert.strictEqual(clone.duration_p95_ms, 1500.33);
    const upload = steps.find(s => s.step === 'upload');
    assert.strictEqual(upload.status, 'OK');
    assert.strictEqual(upload.duration_ms, null, 'no duration point -> null');
    assert.strictEqual(upload.step_name, null);
    assert.deepStrictEqual(shapeShares([]), []);
    assert.deepStrictEqual(shapeJourneySteps(null), []);
    console.log('✔ shapeShares / shapeJourneySteps shape fixture rows per share and per storage step.');

    // ---------------------------------------------------------------- router on a small app
    const app = express();
    app.use((req, _res, next) => { req.sentinelEnv = req.query.environment || undefined; next(); });
    app.use('/api/v2/storage', storageRoutes);
    const server = http.createServer(app);
    const port = await listen(server);
    closers.push(() => new Promise(r => server.close(r)));
    const getJson = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();

    // No ClickHouse configured.
    process.env.CLICKHOUSE_URL = '';
    const off = await getJson('/api/v2/storage/overview?environment=prod');
    assert.strictEqual(off.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(off.environment, 'prod');
    assert.match(off.reason, /ClickHouse is not configured/);
    assert.deepStrictEqual(off.shares, []);
    assert.deepStrictEqual(off.journey_steps, []);
    console.log('✔ No ClickHouse: DATA_UNAVAILABLE with empty shares.');

    // Fake ClickHouse with fixture rows.
    let nasRows = NAS_ROWS;
    let journeyRows = JOURNEY_ROWS;
    const ch = await startFakeClickHouse((sql) => {
      if (/FROM metrics\b/.test(sql) && sql.includes("attributes['share']")) return nasRows;
      if (/FROM metrics\b/.test(sql) && sql.includes("attributes['layer']")) return journeyRows;
      return [];
    });
    closers.push(() => ch.close());
    process.env.CLICKHOUSE_URL = ch.url;
    process.env.CLICKHOUSE_DATABASE = 'sentinel';

    const ok = await getJson('/api/v2/storage/overview?environment=prod&minutes=30');
    assert.strictEqual(ok.status, undefined, 'ready payload has no DATA_UNAVAILABLE status');
    assert.strictEqual(ok.environment, 'prod');
    assert.strictEqual(ok.window_minutes, 30);
    assert.strictEqual(ok.shares.length, 2);
    assert.strictEqual(ok.journey_steps.length, 2);
    assert.deepStrictEqual(ok.summary, { shares: 2, up: 1, down: 1, unknown: 0, journey_steps: 2, journey_steps_failed: 1 });
    assert.strictEqual(ok.shares[0].latency.list.p95_ms, 15);

    const nasReq = ch.requests.find(r => r.sql.includes("attributes['share']"));
    const jReq = ch.requests.find(r => r.sql.includes("attributes['layer']"));
    assert.ok(nasReq && jReq, 'both queries sent');
    for (const r of [nasReq, jReq]) {
      assert.ok(r.sql.includes('env = {env:String}'), 'env is a bound parameter');
      assert.ok(!r.sql.includes("'prod'"), 'env never interpolated');
      assert.strictEqual(r.params.param_env, 'prod');
      assert.strictEqual(r.params.param_window, '30');
    }
    assert.strictEqual(nasReq.params.param_names, "['nas.up','nas.stat_ms','nas.list_ms','nas.read_ms','nas.write_ms']");
    assert.strictEqual(jReq.params.param_names, "['journey.step.duration_ms','journey.success']");
    assert.strictEqual(jReq.params.param_layer, 'storage');
    assert.ok(jReq.sql.includes("attributes['layer'] = {layer:String}"));
    console.log('✔ Fixture rows: parameterised SQL (env bound, nas.* names, storage layer) and per-share records.');

    // Default env when the session carries none: staging, never production.
    const before = ch.requests.length;
    const dflt = await getJson('/api/v2/storage/overview');
    assert.strictEqual(dflt.environment, 'staging');
    assert.ok(ch.requests.slice(before).every(r => r.params.param_env === 'staging'));
    assert.strictEqual(dflt.window_minutes, 60);

    // Journey steps alone still answer (no NAS probe deployed yet).
    nasRows = [];
    const onlySteps = await getJson('/api/v2/storage/overview?environment=staging');
    assert.strictEqual(onlySteps.status, undefined);
    assert.deepStrictEqual(onlySteps.shares, []);
    assert.strictEqual(onlySteps.journey_steps.length, 2);

    // No rows at all -> empty state.
    journeyRows = [];
    const empty = await getJson('/api/v2/storage/overview?environment=staging');
    assert.strictEqual(empty.status, 'DATA_UNAVAILABLE');
    assert.match(empty.reason, /No NAS share probes/);
    assert.deepStrictEqual(empty.shares, []);
    console.log('✔ No rows: DATA_UNAVAILABLE empty state; default env is staging.');

    // ClickHouse error -> DATA_UNAVAILABLE, not a 500.
    const failing = await startFakeClickHouse(() => ({ status: 500, text: 'Code: 60. Table missing' }));
    closers.push(() => failing.close());
    process.env.CLICKHOUSE_URL = failing.url;
    const err = await getJson('/api/v2/storage/overview?environment=staging');
    assert.strictEqual(err.status, 'DATA_UNAVAILABLE');
    assert.match(err.reason, /Failed to query storage telemetry/);
    assert.deepStrictEqual(err.shares, []);
    console.log('✔ ClickHouse failure: DATA_UNAVAILABLE.');

    console.log('\nphase_u_storage: all assertions passed.');
  } finally {
    process.env.CLICKHOUSE_URL = '';
    for (const c of closers.reverse()) await c();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
