/**
 * M1 foundation: read auth policy, environment entitlements, ingest API keys,
 * custom metrics line protocol, source arbitration, leader lock (standalone).
 */
const assert = require('assert');
const http = require('http');

process.env.SENTINEL_INGEST_AUTH_MODE = 'warn';

const { app } = require('../backend/server');
const session = require('../backend/auth/session');
const ingestKeys = require('../backend/auth/ingest_keys');
const accessPolicy = require('../backend/auth/access_policy');
const { parseLine, parseBody } = require('../backend/services/ingest/line_protocol');
const arbiter = require('../metrics_collection/source_arbiter');
const leaderLock = require('../database/leader_lock');
const db = require('../database/db');

function request(port, path, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  console.log('=== RUNNING M1 FOUNDATION TESTS ===');

  // 1. Line protocol
  const now = Date.now();
  const p = parseLine('nas.share.latency_ms,component=nas_performance,share="\\\\filer01\\\\builds",host=lnx01 gauge,42.7 ' + now, now);
  assert.strictEqual(p.metricName, 'nas.share.latency_ms');
  assert.strictEqual(p.component, 'nas_performance');
  assert.strictEqual(p.entity_id, 'host:lnx01');
  assert.strictEqual(p.value, 42.7);
  assert.strictEqual(p.source, 'custom');
  assert.strictEqual(p.attributes.share, '\\filer01\\builds');
  assert.strictEqual(parseLine('jenkins.queue.length 17', now).component, 'jenkins');
  assert.strictEqual(parseLine('x.y gauge,min=1,max=3,sum=6,count=3', now).value, 2);
  assert.strictEqual(parseLine('x.y count,delta=5', now).value, 5);
  const mixed = parseBody('# comment\nok.metric 1\nbad metric line here x\nold.metric 1 1000\n', now);
  assert.strictEqual(mixed.points.length, 1);
  assert.strictEqual(mixed.invalidLines.length, 2);
  console.log('✔ Test 1 Passed: line protocol parses gauge/count/summary and rejects bad lines per line');

  // 2. Source arbiter
  arbiter.reset({ enabled: true, staleMs: 1000, hysteresisPoints: 1, defaultPriority: ['dynatrace', 'otel', 'probe'], metricPriority: {} });
  const base = { env: 'prod', entity_id: 'host:a', component: 'linux', metricName: 'cpu' };
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 0), true, 'otel accepted while dynatrace unseen');
  assert.strictEqual(arbiter.accept({ ...base, source: 'dynatrace' }, 100), true);
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 200), false, 'otel dropped while dynatrace fresh');
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 300), 'dynatrace');
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 1500), true, 'otel accepted once dynatrace is stale');
  assert.strictEqual(arbiter.accept({ ...base, source: 'custom' }, 1500), true, 'unlisted sources always accepted');
  assert.strictEqual(arbiter.accept({ ...base, env: 'staging', source: 'otel' }, 200), true, 'series are per environment');
  arbiter.reset({ enabled: false, staleMs: 1000, defaultPriority: [], metricPriority: {} });
  console.log('✔ Test 2 Passed: source arbiter prefers fresh higher-priority sources and falls back');

  // 2b. Source arbiter hysteresis & anti-flapping (L3)
  arbiter.reset({ enabled: true, staleMs: 1000, hysteresisPoints: 3, defaultPriority: ['dynatrace', 'otel', 'probe'], metricPriority: {} });
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 0), true);
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 0), 'otel');

  // dynatrace sends 1 point at t=100 (consecutive=1 < 3): does not take back priority from otel
  assert.strictEqual(arbiter.accept({ ...base, source: 'dynatrace' }, 100), true);
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 110), true, 'no flapping: otel not dropped on intermittent dynatrace');
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 110), 'otel');

  // dynatrace sends point 2 at t=200 (consecutive=2 < 3)
  assert.strictEqual(arbiter.accept({ ...base, source: 'dynatrace' }, 200), true);
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 210), true);

  // dynatrace sends point 3 at t=300 (consecutive=3 >= 3): takes back priority
  assert.strictEqual(arbiter.accept({ ...base, source: 'dynatrace' }, 300), true);
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 300), 'dynatrace');
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 310), false, 'otel dropped once dynatrace establishes priority');

  // markAuthFailed immediately marks source as stale
  arbiter.markAuthFailed('dynatrace');
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 320), 'otel');
  assert.strictEqual(arbiter.accept({ ...base, source: 'otel' }, 320), true, 'otel accepted immediately on AUTH_FAILED');
  assert.strictEqual(arbiter.activeSource('prod', 'host:a', 'cpu', 320), 'otel');

  const activeSources = arbiter.getActiveSources('prod', 320);
  assert.strictEqual(activeSources.length, 1);
  assert.strictEqual(activeSources[0].activeSource, 'otel');
  console.log('✔ Test 2b Passed: source arbiter hysteresis, anti-flapping, and AUTH_FAILED handling');

  // 3. Access policy
  delete process.env.SENTINEL_REQUIRE_AUTH_READS;
  assert.strictEqual(accessPolicy.requiresAuthForReads(), process.env.NODE_ENV === 'production');
  process.env.SENTINEL_REQUIRE_AUTH_READS = 'true';
  assert.strictEqual(accessPolicy.requiresAuthForReads(), true);
  assert.strictEqual(accessPolicy.isPublicReadPath('/api/ui-config'), true);
  assert.strictEqual(accessPolicy.isEntitled({ role: 'Super Admin' }, 'prod'), true);
  console.log('✔ Test 3 Passed: read-auth policy honours env override and public paths');

  // 4. Leader lock without a database: standalone leader
  assert.strictEqual(leaderLock.isLeader(), true);
  console.log('✔ Test 4 Passed: leader lock is standalone leader without a database');

  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  try {
    // 5. Reads require a session when the policy says so
    const anon = await request(port, '/api/alerts?environment=staging');
    assert.strictEqual(anon.status, 401, 'anonymous read must be rejected when reads require auth');
    const pub = await request(port, '/api/ui-config');
    assert.strictEqual(pub.status, 200, 'ui-config stays public');
    const token = session.generateToken({ username: 'viewer@corp', role: 'Viewer' });
    const authed = await request(port, '/api/alerts?environment=staging', { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(authed.status, 200);
    console.log('✔ Test 5 Passed: anonymous reads are rejected, sessions and public paths pass');

    // 6. Environment entitlement (configured via global.yaml security block in production)
    const yamlConfig = require('../backend/config/yaml_config');
    const g = yamlConfig.loadGlobalConfig();
    const previous = g.security;
    g.security = { ...(previous || {}), environment_entitlements: { Viewer: ['staging', 'demo'] } };
    const denied = await request(port, '/api/alerts?environment=prod', { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(denied.status, 403, 'Viewer must not read prod when not entitled');
    const allowed = await request(port, '/api/alerts?environment=staging', { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(allowed.status, 200);
    g.security = previous;
    delete process.env.SENTINEL_REQUIRE_AUTH_READS;
    console.log('✔ Test 6 Passed: per-role environment entitlements enforced');

    // 7. Ingest keys: enforce mode rejects missing keys, key binds the environment
    const raw = ingestKeys.generateKey();
    process.env.SENTINEL_INGEST_API_KEYS = `jenkins-cron:staging:${ingestKeys.hashKey(raw)}`;
    process.env.SENTINEL_INGEST_AUTH_MODE = 'enforce';
    const noKey = await request(port, '/api/v1/metrics/ingest', { method: 'POST', body: 'm1.test 1', headers: { 'Content-Type': 'text/plain' } });
    assert.strictEqual(noKey.status, 401);
    const badKey = await request(port, '/v1/metrics', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': 'snk_wrong' } });
    assert.strictEqual(badKey.status, 401);
    const ok = await request(port, '/api/v1/metrics/ingest?environment=prod', {
      method: 'POST',
      body: 'm1.test.latency,component=m1test,host=h1 12.5\nbroken line x y z',
      headers: { 'Content-Type': 'text/plain', 'X-Sentinel-Api-Key': raw }
    });
    assert.strictEqual(ok.status, 202);
    assert.strictEqual(ok.data.linesOk, 1);
    assert.strictEqual(ok.data.linesInvalid, 1);
    assert.strictEqual(ok.data.environment, 'staging', 'the key decides the environment, not the query');
    const stored = db.getMetrics('m1test', 10, 'staging').find(m => m.metricName === 'm1.test.latency');
    assert.ok(stored, 'custom metric stored');
    assert.strictEqual(stored.source, 'custom');
    assert.strictEqual(stored.value, 12.5);
    assert.ok(!db.getMetrics('m1test', 10, 'prod').some(m => m.metricName === 'm1.test.latency'), 'nothing written to prod');
    process.env.SENTINEL_INGEST_AUTH_MODE = 'warn';
    delete process.env.SENTINEL_INGEST_API_KEYS;
    console.log('✔ Test 7 Passed: ingest keys enforced and bind the environment');

    // 8. Gateway key scope and allowed_environments (L4)
    const gwKey1 = ingestKeys.generateKey();
    const gwKey2 = ingestKeys.generateKey();
    process.env.SENTINEL_INGEST_API_KEYS = [
      `gw-stg-only:staging:${ingestKeys.hashKey(gwKey1)}:gateway;metrics:staging`,
      `gw-multi:prod:${ingestKeys.hashKey(gwKey2)}:gateway;metrics:prod;staging`
    ].join(',');
    process.env.SENTINEL_INGEST_AUTH_MODE = 'enforce';

    function makeOtlpPayload(targetEnv, metricKey = 'system.cpu.utilization', val = 0.5) {
      return JSON.stringify({
        resourceMetrics: [{
          resource: {
            attributes: [
              { key: 'host.name', value: { stringValue: 'gw-node-x' } },
              { key: 'application.id', value: { stringValue: 'gwtest' } },
              { key: 'deployment.environment', value: { stringValue: targetEnv } }
            ]
          },
          scopeMetrics: [{
            metrics: [{
              name: metricKey,
              gauge: {
                dataPoints: [{
                  asDouble: val,
                  timeUnixNano: String(BigInt(Date.now()) * 1000000n)
                }]
              }
            }]
          }]
        }]
      });
    }

    // Key with allowed_environments = [staging] attempts to push prod metrics
    await request(port, '/v1/metrics', {
      method: 'POST',
      body: makeOtlpPayload('prod'),
      headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': gwKey1 }
    });
    const prodCheck1 = db.getMetrics('gwtest', 10, 'prod').find(m => m.metricName === 'cpu');
    assert.strictEqual(prodCheck1, undefined, 'gateway key allowed only [staging] must not write prod');

    // Key with allowed_environments = [prod, staging] pushes prod then staging
    await request(port, '/v1/metrics', {
      method: 'POST',
      body: makeOtlpPayload('prod'),
      headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': gwKey2 }
    });
    const prodCheck2 = db.getMetrics('gwtest', 10, 'prod').find(m => m.metricName === 'cpu');
    assert.ok(prodCheck2, 'gateway key allowed [prod, staging] routes prod by attribute');

    await request(port, '/v1/metrics', {
      method: 'POST',
      body: makeOtlpPayload('staging'),
      headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': gwKey2 }
    });
    const stgCheck2 = db.getMetrics('gwtest', 10, 'staging').find(m => m.metricName === 'cpu');
    assert.ok(stgCheck2, 'gateway key allowed [prod, staging] routes staging by attribute');

    process.env.SENTINEL_INGEST_AUTH_MODE = 'warn';
    delete process.env.SENTINEL_INGEST_API_KEYS;
    console.log('✔ Test 8 Passed: gateway key scope and allowed_environments routing');
  } finally {
    server.close();
  }

  console.log('=== ALL M1 FOUNDATION TESTS PASSED ===');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
