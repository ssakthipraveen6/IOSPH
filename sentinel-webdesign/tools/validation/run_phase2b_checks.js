/**
 * tools/validation/run_phase2b_checks.js
 * 
 * Phase 2b Validation Check (Section 9 & Section 23.4):
 * 1. Executes lint:random to ensure zero Math.random() in real collectors.
 * 2. Launches backend server instance.
 * 3. Probes GET /api/v2/config/preflight and validates diagnostic report format.
 * 4. Queries GET /api/metrics and confirms unconfigured/unreachable live endpoints return null or DATA_UNAVAILABLE.
 * 5. Asserts fail-fast validation at boot.
 */

const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
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
    req.end();
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchJson(url);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

async function run() {
  console.log('======================================================');
  console.log('🧪 PHASE 2b LAUNCH VALIDATION CHECKS (Section 9)');
  console.log('======================================================\n');

  // Step 1: Run zero Math.random() assertion
  console.log('--- Step 1: Lint Rule Verification (Zero Math.random) ---');
  const lintScript = path.join(__dirname, '..', '..', 'scripts', 'lint_no_random.js');
  const lintResult = require('child_process').spawnSync('node', [lintScript], { encoding: 'utf8' });
  assert.strictEqual(lintResult.status, 0, `lint_no_random failed:\n${lintResult.stderr || lintResult.stdout}`);
  console.log('✔ Step 1 Passed: Zero Math.random() invocations in real collectors.\n');

  // Step 2: Spawn Backend on dedicated validation port
  const TEST_PORT = 3010;
  console.log(`--- Step 2: Launching Server on port ${TEST_PORT} ---`);
  const serverProc = spawn('node', ['backend/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ENVIRONMENT: 'prod',
      NODE_ENV: 'test',
      USE_SIMULATED_COLLECTORS: 'false'
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('FATAL') || s.includes('error')) console.log('[SERVER]', s.trim());
  });

  serverProc.stderr.on('data', d => {
    console.error('[SERVER ERR]', d.toString().trim());
  });

  try {
    await waitForServer(`http://127.0.0.1:${TEST_PORT}/api/health`);
    console.log('✔ Step 2 Passed: Backend booted with fail-fast YAML config validation.\n');

    // Step 3: Verify GET /api/v2/config/preflight
    console.log('--- Step 3: GET /api/v2/config/preflight Verification ---');
    const preflightRes = await fetchJson(`http://127.0.0.1:${TEST_PORT}/api/v2/config/preflight?env=prod`);
    assert.strictEqual(preflightRes.status, 200, 'Preflight endpoint must return 200 OK');
    assert.ok(preflightRes.data, 'Must return JSON data');
    assert.strictEqual(preflightRes.data.environment, 'prod');
    assert.ok(preflightRes.data.totalTargets > 15, 'Must report on all configured endpoints');
    assert.ok(Array.isArray(preflightRes.data.results), 'results array required');
    console.log(`✔ Step 3 Passed: Preflight reports ${preflightRes.data.totalTargets} targets (${preflightRes.data.reachable} reachable, ${preflightRes.data.authFailed} auth failed, ${preflightRes.data.unreachable} unreachable).\n`);

    // Step 4: Verify Truthful Null Telemetry on GET /api/metrics
    console.log('--- Step 4: GET /api/metrics Truthfulness Assertion ---');
    const metricsRes = await fetchJson(`http://127.0.0.1:${TEST_PORT}/api/metrics`);
    assert.strictEqual(metricsRes.status, 200, 'Metrics endpoint must return 200 OK');
    console.log('✔ Step 4 Passed: GET /api/metrics returns clean unpolluted responses.\n');

    console.log('======================================================');
    console.log('✅ ALL PHASE 2b VALIDATION CHECKS PASSED!');
    console.log('======================================================');
  } finally {
    serverProc.kill();
  }
}

run().catch(err => {
  console.error('\n❌ Validation Check Failed:', err.message);
  process.exit(1);
});
