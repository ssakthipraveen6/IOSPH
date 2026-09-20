/**
 * tests/environment_isolation.test.js
 *
 * Automated verification of Per-User Environment Isolation (Phase 1c / Section 7).
 * Tests:
 *  1. JWT token environment claim packaging and verification
 *  2. OTLP metric normalizer environment extraction from resource attributes
 *  3. Multi-client WebSocket subscription isolation (PROD vs STG vs DEMO)
 *  4. Ingest tagging isolation from UI clicks
 *  5. Elimination of global environment mutability across sessions
 */

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const session = require('../backend/auth/session');
const { normalizeOtlpPayload } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');

const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SENTINEL_JWT_SECRET = JWT_SECRET;

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchJson(url);
      if (res.status === 200 || res.status === 404) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

async function runTests() {
  console.log('=== RUNNING PER-USER ENVIRONMENT ISOLATION TESTS (Phase 1c) ===');

  // Test 1: JWT token packages user environment claim
  const prodUser = { username: 'sre_prod_user', role: 'SRE Lead', environment: 'prod' };
  const prodToken = session.generateToken(prodUser);
  const verifiedProd = session.verifyToken(prodToken);
  assert.strictEqual(verifiedProd.environment, 'prod', 'Expected JWT claim to include environment: prod');

  const stgUser = { username: 'dev_user', role: 'Operator', environment: 'staging' };
  const stgToken = session.generateToken(stgUser);
  const verifiedStg = session.verifyToken(stgToken);
  assert.strictEqual(verifiedStg.environment, 'staging', 'Expected JWT claim to include environment: staging');
  console.log('✔ Test 1 Passed: JWT accurately packages environment session claim');

  // Test 2: OTLP normalizer extracts environment strictly from payload resource attributes
  const otlpProdPayload = {
    resourceMetrics: [{
      resource: {
        attributes: [
          { key: 'host.name', value: { stringValue: 'ci-worker-01.corp' } },
          { key: 'deployment.environment', value: { stringValue: 'prod' } }
        ]
      },
      scopeMetrics: [{
        metrics: [{
          name: 'system.cpu.utilization',
          gauge: { dataPoints: [{ asDouble: 0.42 }] }
        }]
      }]
    }]
  };

  const parsed = normalizeOtlpPayload(otlpProdPayload);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].env, 'prod', 'Expected normalized metric to be explicitly tagged with env: prod');
  console.log('✔ Test 2 Passed: OTLP metric normalizer preserves resource attribute environment tag');

  // Test 3: Start backend server and test multi-session WebSocket isolation
  const serverPort = '3009';
  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SENTINEL_JWT_SECRET: JWT_SECRET,
      PORT: serverPort,
      ENVIRONMENT: 'staging'
    },
    stdio: 'pipe'
  });

  try {
    await waitForServer(`http://localhost:${serverPort}/healthz`);
    console.log(`[CHECK] Backend test instance healthy on port ${serverPort}`);

    // Connect Client A on PROD
    const wsA = new WebSocket(`ws://localhost:${serverPort}/ws?environment=prod`);
    // Connect Client B on STG
    const wsB = new WebSocket(`ws://localhost:${serverPort}/ws?environment=staging`);

    const messagesA = [];
    const messagesB = [];

    wsA.on('message', data => messagesA.push(JSON.parse(data)));
    wsB.on('message', data => messagesB.push(JSON.parse(data)));

    await new Promise(r => setTimeout(r, 1500));

    // Assert initial frames reflect distinct environments
    const initA = messagesA.find(m => m.type === 'init');
    const initB = messagesB.find(m => m.type === 'init');

    assert.ok(initA, 'Client A must receive init frame');
    assert.ok(initB, 'Client B must receive init frame');
    assert.strictEqual(initA.data.health.environment, 'prod', 'Client A must receive prod health');
    assert.strictEqual(initB.data.health.environment, 'staging', 'Client B must receive staging health');
    console.log('✔ Test 3 Passed: Multi-client initial frames accurately isolated (PROD vs STG)');

    // Test 4: Client C switches to DEMO -> Assert A and B do not switch
    const wsC = new WebSocket(`ws://localhost:${serverPort}/ws?environment=demo`);
    const messagesC = [];
    wsC.on('message', data => messagesC.push(JSON.parse(data)));

    await new Promise(r => setTimeout(r, 1000));
    const initC = messagesC.find(m => m.type === 'init');
    assert.ok(initC);
    assert.strictEqual(initC.data.health.environment, 'demo');

    // Make an API switch call to /api/environment
    const switchRes = await fetchJson(`http://localhost:${serverPort}/api/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { environment: 'demo' }
    });
    assert.strictEqual(switchRes.status, 200);

    // Wait for a metrics_tick cycle (5s)
    await new Promise(r => setTimeout(r, 6000));

    // Check latest metrics_tick for A, B, C
    const tickA = messagesA.filter(m => m.type === 'metrics_tick').pop();
    const tickB = messagesB.filter(m => m.type === 'metrics_tick').pop();
    const tickC = messagesC.filter(m => m.type === 'metrics_tick').pop();

    assert.ok(tickA, 'Client A must receive metrics_tick');
    assert.ok(tickB, 'Client B must receive metrics_tick');
    assert.ok(tickC, 'Client C must receive metrics_tick');

    assert.strictEqual(tickA.data.health.environment, 'prod', 'Client A must remain on PROD');
    assert.strictEqual(tickB.data.health.environment, 'staging', 'Client B must remain on STG');
    assert.strictEqual(tickC.data.health.environment, 'demo', 'Client C must remain on DEMO');
    console.log('✔ Test 4 Passed: Third client on DEMO does not alter active PROD or STG sessions');

    // Test 5: OTLP metrics push with environment: prod tags metric as prod in DB
    const otlpRes = await fetchJson(`http://localhost:${serverPort}/v1/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: otlpProdPayload
    });
    assert.strictEqual(otlpRes.status, 200);

    // Query metrics for prod vs staging
    const prodMetricsRes = await fetchJson(`http://localhost:${serverPort}/api/metrics?environment=prod`);
    assert.strictEqual(prodMetricsRes.status, 200);
    const hasProdTagged = prodMetricsRes.data.some(m => m.env === 'prod' && m.component === 'ci-worker-01.corp');
    assert.ok(hasProdTagged, 'Expected metric from OTLP push to be tagged env: prod in database');

    const stgMetricsRes = await fetchJson(`http://localhost:${serverPort}/api/metrics?environment=staging`);
    assert.strictEqual(stgMetricsRes.status, 200);
    const hasStgCorrupted = stgMetricsRes.data.some(m => m.component === 'ci-worker-01.corp');
    assert.ok(!hasStgCorrupted, 'Production OTLP metric must NOT leak into staging');
    console.log('✔ Test 5 Passed: Ingest tagging comes strictly from agent attributes, zero UI crosstalk');

    wsA.close();
    wsB.close();
    wsC.close();

    console.log('=== ALL PER-USER ENVIRONMENT ISOLATION TESTS PASSED ===');
  } finally {
    serverProc.kill('SIGKILL');
  }
}

runTests().catch(err => {
  console.error('=== PER-USER ENVIRONMENT ISOLATION TESTS FAILED ===', err);
  process.exit(1);
});
