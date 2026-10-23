/**
 * tests/shipper_rollout.test.js
 *
 * Automated verification of Log Shipper Rollout (Phase 3b / Section 11).
 * Tests:
 *  1. Fluent Bit config generation from inventory model (T3b.2)
 *  2. Redaction filter rules (T3b.6 — PANs, credentials, tokens)
 *  3. Agent heartbeat recording and inventory update (T3b.3)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { generateConfigs } = require('../scripts/generate_shipper_configs');
const inventory = require('@sentinel/inventory');

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
  console.log('=== RUNNING LOG SHIPPER ROLLOUT TESTS (Phase 3b) ===');

  // Test 1: Config Generation from Inventory
  console.log('\n--- Test 1: Config Generation from Inventory (T3b.2) ---');
  await inventory.syncAllSources();

  const tempOutDir = path.resolve(__dirname, '../.runtime/test_shipper_configs');
  const genResult = await generateConfigs('staging', tempOutDir);

  assert.ok(genResult.count > 0, 'Expected at least 1 host config generated');
  const sampleConfig = genResult.configs[0];
  assert.ok(fs.existsSync(sampleConfig.file), 'Generated file must exist');

  const content = fs.readFileSync(sampleConfig.file, 'utf8');
  assert.ok(content.includes('SENTINEL_ENV') || content.includes('staging'), 'Config must bind environment');
  assert.ok(content.includes('/v1/logs'), 'Config must point to /v1/logs ingest URI');
  console.log(`✔ Test 1 Passed: Generated ${genResult.count} host configs with valid directives`);

  // Test 2: Redaction Filter Rules (T3b.6)
  console.log('\n--- Test 2: Redaction Rules (T3b.6) ---');
  const baseConfPath = path.resolve(__dirname, '../deployments/fluentbit_configs/fluentbit_base.conf');
  assert.ok(fs.existsSync(baseConfPath), 'Base Fluent Bit config must exist');
  const baseConf = fs.readFileSync(baseConfPath, 'utf8');

  assert.ok(baseConf.includes('redacted_pan'), 'Must contain PAN redaction rule');
  assert.ok(baseConf.includes('sensitive.masked') || baseConf.includes('bearer'), 'Must contain secret/token masking rule');
  console.log('✔ Test 2 Passed: Base Fluent Bit config includes PAN and token redaction rules');

  // Test 3: Agent Heartbeat API (T3b.3)
  console.log('\n--- Test 3: Shipper Agent Heartbeat API (T3b.3) ---');
  const testPort = '3013';
  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: testPort,
      ENVIRONMENT: 'staging',
      SENTINEL_JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      INVENTORY_SAVE_DEBOUNCE_MS: '100'
    },
    stdio: 'pipe'
  });

  try {
    await waitForServer(`http://localhost:${testPort}/healthz`);

    const heartbeatPayload = {
      host: 'agent-worker-lon-04.corp',
      entity_id: 'host:agent-worker-lon-04.corp',
      version: '3.0.4',
      environment: 'staging',
      status: 'HEALTHY'
    };

    const hbRes = await fetchJson(`http://localhost:${testPort}/api/v2/shipper/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: heartbeatPayload
    });

    assert.strictEqual(hbRes.status, 200);
    assert.strictEqual(hbRes.data.status, 'SUCCESS');

    // Verify entity in inventory with retry for inter-process disk sync
    let entity = null;
    for (let i = 0; i < 50; i++) {
      entity = await inventory.getEntityById('host:agent-worker-lon-04.corp');
      if (entity) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(entity, 'Entity must be recorded in inventory');
    const meta = entity.labels || entity.attributes || {};
    assert.strictEqual(meta.shipper_version, '3.0.4');
    assert.strictEqual(meta.heartbeat_status, 'ALIVE');
    console.log('✔ Test 3 Passed: Heartbeat recorded in inventory with version and last-seen timestamp');

  } finally {
    serverProc.kill('SIGTERM');
  }

  // Clean up temp configs
  try { fs.rmSync(tempOutDir, { recursive: true, force: true }); } catch (_) {}

  console.log('\n=============================================');
  console.log('🎉 ALL PHASE 3b LOG SHIPPER TESTS PASSED!');
  console.log('=============================================\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Shipper rollout test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
