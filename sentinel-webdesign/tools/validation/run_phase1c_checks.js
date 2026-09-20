/**
 * tools/validation/run_phase1c_checks.js
 *
 * Phase 1c Launch Validation (Section 23.4):
 * "1. Browser A logs in, selects PROD. Browser B logs in, selects STG.
 *  2. Leave both open under active collection.
 *  3. Neither switches. B stays on STG; its alerts and recovery panels stay STG.
 *  4. Browser C selects DEMO. A and B are unaffected; no simulation in A or B is cleared.
 *  5. Throughout, the OTLP fixture pushes with environment: prod resource attributes.
 *     Query the DB: every row is tagged prod, regardless of what any browser had selected."
 */

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

async function run() {
  console.log('=== RUNNING PHASE 1c LAUNCH VALIDATION (Section 23.4) ===');

  const serverPort = '3002';
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

  serverProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('OTEL') || s.includes('ENVIRONMENT_SWITCH') || s.includes('ERROR')) {
      process.stdout.write(`[SERVER] ${s}`);
    }
  });
  serverProc.stderr.on('data', d => process.stderr.write(`[SERVER-ERR] ${d}`));

  try {
    await waitForServer(`http://localhost:${serverPort}/healthz`);
    console.log(`[CHECK] Backend running on :${serverPort}`);

    // 1. Session A: connects on PROD
    console.log('[CHECK] Initializing Session A on PROD and Session B on STG...');
    const wsA = new WebSocket(`ws://localhost:${serverPort}/ws?environment=prod`);
    const messagesA = [];
    wsA.on('message', d => messagesA.push(JSON.parse(d)));

    // 2. Session B: connects on STG
    const wsB = new WebSocket(`ws://localhost:${serverPort}/ws?environment=staging`);
    const messagesB = [];
    wsB.on('message', d => messagesB.push(JSON.parse(d)));

    await new Promise(r => setTimeout(r, 1200));

    // Verify initial states
    const initA = messagesA.find(m => m.type === 'init');
    const initB = messagesB.find(m => m.type === 'init');

    assert.ok(initA, 'Session A must receive init frame');
    assert.ok(initB, 'Session B must receive init frame');
    assert.strictEqual(initA.data.health.environment, 'prod', 'Session A init environment must be prod');
    assert.strictEqual(initB.data.health.environment, 'staging', 'Session B init environment must be staging');
    console.log('✔ Verified: Session A initialized to PROD, Session B initialized to STG');

    // 3. Session C connects and selects DEMO
    console.log('[CHECK] Connecting Session C and switching to DEMO...');
    const wsC = new WebSocket(`ws://localhost:${serverPort}/ws?environment=demo`);
    const messagesC = [];
    wsC.on('message', d => messagesC.push(JSON.parse(d)));

    const switchRes = await fetchJson(`http://localhost:${serverPort}/api/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { environment: 'demo' }
    });
    assert.strictEqual(switchRes.status, 200);

    // 4. Concurrently push synthetic OTLP telemetry with environment: prod
    console.log('[CHECK] Pushing OTLP telemetry with resource attribute environment: prod...');
    const otlpPayload = {
      resourceMetrics: [{
        resource: {
          attributes: [
            { key: 'host.name', value: { stringValue: 'phase1c-node-prod.corp' } },
            { key: 'deployment.environment', value: { stringValue: 'prod' } },
            { key: 'service.name', value: { stringValue: 'cloudbees_jenkins' } }
          ]
        },
        scopeMetrics: [{
          metrics: [{
            name: 'system.cpu.utilization',
            gauge: { dataPoints: [{ asDouble: 0.77 }] }
          }]
        }]
      }]
    };

    const otlpRes = await fetchJson(`http://localhost:${serverPort}/v1/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: otlpPayload
    });
    assert.strictEqual(otlpRes.status, 200);

    // 5. Wait across collection and broadcast ticks (6s)
    console.log('[CHECK] Waiting across collection ticks (6s)...');
    await new Promise(r => setTimeout(r, 6000));

    // Verify Session A and B maintained distinct states without crosstalk
    const ticksA = messagesA.filter(m => m.type === 'metrics_tick');
    const ticksB = messagesB.filter(m => m.type === 'metrics_tick');
    const ticksC = messagesC.filter(m => m.type === 'metrics_tick');

    assert.ok(ticksA.length > 0, 'Session A must receive metrics_tick');
    assert.ok(ticksB.length > 0, 'Session B must receive metrics_tick');
    assert.ok(ticksC.length > 0, 'Session C must receive metrics_tick');

    const lastTickA = ticksA[ticksA.length - 1];
    const lastTickB = ticksB[ticksB.length - 1];
    const lastTickC = ticksC[ticksC.length - 1];

    assert.strictEqual(lastTickA.data.health.environment, 'prod', 'Session A must remain on PROD');
    assert.strictEqual(lastTickB.data.health.environment, 'staging', 'Session B must remain on STG');
    assert.strictEqual(lastTickC.data.health.environment, 'demo', 'Session C must remain on DEMO');
    console.log('✔ Verified: Sessions hold distinct environments indefinitely with zero crosstalk (PROD vs STG vs DEMO)');

    // 6. Verify OTLP database tagging: all rows tagged prod regardless of active demo session
    console.log('[CHECK] Verifying OTLP ingest database tagging...');
    const prodMetrics = await fetchJson(`http://localhost:${serverPort}/api/metrics?environment=prod`);
    assert.strictEqual(prodMetrics.status, 200);
    const prodTagged = prodMetrics.data.filter(m => m.component === 'cloudbees_jenkins' || m.entity_id?.includes('phase1c-node-prod'));
    assert.ok(prodTagged.length > 0, 'Metric must be recorded under environment: prod');
    assert.ok(prodTagged.every(m => m.env === 'prod'), 'Every ingested OTLP row must strictly be tagged prod');

    const stgMetrics = await fetchJson(`http://localhost:${serverPort}/api/metrics?environment=staging`);
    assert.strictEqual(stgMetrics.status, 200);
    const leakedIntoStg = stgMetrics.data.filter(m => m.entity_id?.includes('phase1c-node-prod'));
    assert.strictEqual(leakedIntoStg.length, 0, 'Prod OTLP metrics must never leak into staging database partition');

    console.log('✔ Verified: OTLP ingest tagged strictly from agent attributes (zero UI session pollution)');

    wsA.close();
    wsB.close();
    wsC.close();

    console.log('=== PHASE 1c LAUNCH VALIDATION PASSED SUCCESSFULLY ===');
  } finally {
    serverProc.kill('SIGKILL');
  }
}

run().catch(err => {
  console.error('=== PHASE 1c LAUNCH VALIDATION FAILED ===', err);
  process.exit(1);
});
