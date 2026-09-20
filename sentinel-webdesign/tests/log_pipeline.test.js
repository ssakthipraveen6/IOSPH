/**
 * tests/log_pipeline.test.js
 *
 * Automated verification of Log Pipeline and Log Explorer (Phase 3 / Section 10).
 * Tests:
 *  1. Log parsing and level normalization
 *  2. Masked fingerprint generation (numbers, IPs, UUIDs, paths)
 *  3. Time-bounded query enforcement (unbounded queries rejected)
 *  4. Keyset pagination on (ts, id) without duplicate or missed rows
 *  5. File tailer persistent byte offsets and rotation detection
 *  6. Live HTTP ingest (POST /v1/logs with Fluentd JSON and OTLP/logs)
 *  7. Log search, histogram, and facets API endpoints
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const logParser = require('../logs_collection/parser/log_parser');
const logStore = require('../database/log_store');
const { tailFile } = require('../logs_collection/real/fluentd/fluentd_log_collector');

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
  console.log('=== RUNNING LOG PIPELINE TESTS (Phase 3) ===');

  // Test 1: Log Parsing & Level Normalization
  console.log('\n--- Test 1: Log Parsing & Level Normalization ---');
  const rawLine1 = '2026-09-20 14:32:00.123 [worker-4] ERROR com.enterprise.db.Pool - Connection pool exhausted (active: 100, max: 100)';
  const parsed1 = logParser.parseLog(rawLine1, { environment: 'prod', app_id: 'db_pool' });

  assert.strictEqual(parsed1.level, 'ERROR');
  assert.strictEqual(parsed1.environment, 'prod');
  assert.ok(parsed1.message.includes('Connection pool exhausted'));
  console.log('✔ Test 1 Passed: Log4j line parsed with level=ERROR and metadata');

  // Test 2: Masked Fingerprint Generation
  console.log('\n--- Test 2: Masked Fingerprint Generation ---');
  const sampleMsgA = 'User session 4a8b7f12-9c3d-4e5f-a1b2-c3d4e5f6a7b8 connected from 192.168.1.45 to /var/log/app/server.log in 350ms';
  const sampleMsgB = 'User session e9f8a7b6-c5d4-3e2f-1a0b-9c8d7e6f5a4b connected from 10.0.0.12 to /opt/sentinel/logs/audit.log in 12ms';

  const templateA = logParser.generateFingerprintTemplate(sampleMsgA);
  const templateB = logParser.generateFingerprintTemplate(sampleMsgB);

  assert.ok(templateA.includes('<UUID>'), 'Expected UUID masked');
  assert.ok(templateA.includes('<IP>'), 'Expected IP masked');
  assert.ok(templateA.includes('<PATH>'), 'Expected PATH masked');
  assert.ok(templateA.includes('<NUM>'), 'Expected latency/number masked');

  const fpA = logParser.computeFingerprint(templateA);
  const fpB = logParser.computeFingerprint(templateB);

  assert.strictEqual(templateA, templateB, 'Expected identical template for structurally matching logs');
  assert.strictEqual(fpA, fpB, 'Expected identical fingerprint for structurally matching logs');
  console.log(`✔ Test 2 Passed: Dynamic variables masked. Template: "${templateA}", FP: ${fpA}`);

  // Test 3: Time-Bounded Query Enforcement
  console.log('\n--- Test 3: Time-Bounded Query Enforcement ---');
  logStore.clearMemoryBuffer();

  let unboundedRejected = false;
  try {
    await logStore.searchLogs({ q: 'error' }); // Missing from and to
  } catch (err) {
    unboundedRejected = true;
    assert.ok(err.message.includes('required'), 'Expected error requiring from and to');
  }
  assert.strictEqual(unboundedRejected, true, 'Unbounded query must throw error in logStore');
  console.log('✔ Test 3 Passed: Unbounded query rejected at storage boundary');

  // Test 4: Ingestion, Keyset Pagination, and Cursor Traversal
  console.log('\n--- Test 4: Keyset Pagination & Keyset Cursor Traversal ---');
  const now = Date.now();
  const testLogs = [];
  for (let i = 0; i < 25; i++) {
    testLogs.push({
      ts: new Date(now - (25 - i) * 1000).toISOString(),
      level: i % 2 === 0 ? 'INFO' : 'ERROR',
      app_id: 'payment_service',
      message: `Transaction step ${i} completed in ${i * 10}ms`,
      environment: 'staging'
    });
  }

  await logStore.appendLogs(testLogs);
  const fromTime = new Date(now - 60000).toISOString();
  const toTime = new Date(now + 10000).toISOString();

  // Page 1: limit 10
  const page1 = await logStore.searchLogs({
    from: fromTime,
    to: toTime,
    environment: 'staging',
    app_id: 'payment_service',
    limit: 10
  });

  assert.strictEqual(page1.items.length, 10, 'Expected 10 items on page 1');
  assert.ok(page1.nextCursor, 'Expected nextCursor for page 2');

  // Page 2: with cursor
  const page2 = await logStore.searchLogs({
    from: fromTime,
    to: toTime,
    environment: 'staging',
    app_id: 'payment_service',
    limit: 10,
    cursor: page1.nextCursor
  });

  assert.strictEqual(page2.items.length, 10, 'Expected 10 items on page 2');
  assert.ok(page2.nextCursor, 'Expected nextCursor for page 3');

  // Assert no duplicates across page 1 and page 2
  const idsP1 = new Set(page1.items.map(it => it.id));
  page2.items.forEach(it => {
    assert.ok(!idsP1.has(it.id), `ID ${it.id} duplicated across keyset pages!`);
  });

  // Page 3: remaining items
  const page3 = await logStore.searchLogs({
    from: fromTime,
    to: toTime,
    environment: 'staging',
    app_id: 'payment_service',
    limit: 10,
    cursor: page2.nextCursor
  });

  assert.strictEqual(page3.items.length, 5, 'Expected 5 items on page 3');
  assert.strictEqual(page3.nextCursor, null, 'Expected null cursor on final page');
  console.log('✔ Test 4 Passed: Keyset pagination traversed 25 items across 3 pages without duplicates');

  // Test 5: Persistent Tailer (Byte Offsets & Inode Rotation)
  console.log('\n--- Test 5: Persistent Tailer Offsets & Inode Rotation ---');
  const tempLogFile = path.resolve(__dirname, '../.runtime/test_tailer.log');
  const dir = path.dirname(tempLogFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const offsets = {};

  // Step 5a: Initial write
  fs.writeFileSync(tempLogFile, 'Line 1 from service\nLine 2 from service\nLine 3 from service\n', 'utf8');
  const tail1 = tailFile(tempLogFile, offsets, 'staging');
  assert.strictEqual(tail1.lines.length, 3, 'Expected 3 lines read on initial tail');
  assert.ok(offsets[path.normalize(tempLogFile)].offset > 0, 'Offset must be saved');

  // Step 5b: No new data -> 0 lines
  const tail2 = tailFile(tempLogFile, offsets, 'staging');
  assert.strictEqual(tail2.lines.length, 0, 'Expected 0 new lines when file unchanged');

  // Step 5c: Append 2 new lines
  fs.appendFileSync(tempLogFile, 'Line 4 from service\nLine 5 from service\n', 'utf8');
  const tail3 = tailFile(tempLogFile, offsets, 'staging');
  assert.strictEqual(tail3.lines.length, 2, 'Expected exactly 2 newly appended lines');
  assert.strictEqual(tail3.lines[0], 'Line 4 from service');

  // Step 5d: Rotation / Truncation (copytruncate)
  fs.writeFileSync(tempLogFile, 'Rotated Line 1\nRotated Line 2\n', 'utf8');
  const tail4 = tailFile(tempLogFile, offsets, 'staging');
  assert.strictEqual(tail4.lines.length, 2, 'Expected 2 lines after rotation reset');
  assert.strictEqual(tail4.lines[0], 'Rotated Line 1');

  // Clean up temp log file
  try { fs.unlinkSync(tempLogFile); } catch (_) {}
  console.log('✔ Test 5 Passed: Tailer tracks byte offsets and handles file rotation cleanly');

  // Test 6 & 7: Live HTTP Ingestion & Search APIs
  console.log('\n--- Test 6 & 7: Live HTTP Ingestion & API Endpoints ---');
  const testPort = '3011';
  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: testPort,
      ENVIRONMENT: 'staging',
      SENTINEL_JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    },
    stdio: 'pipe'
  });

  try {
    await waitForServer(`http://localhost:${testPort}/healthz`);
    console.log(`[CHECK] Test server healthy on port ${testPort}`);

    // Ingest via POST /v1/logs (Fluentd JSON array)
    const fluentdPayload = [
      { message: '[APP-AUTH] User authenticated successfully: admin', level: 'INFO', app_id: 'auth_service' },
      { message: '[APP-AUTH] Token verification failed: expired session token', level: 'WARN', app_id: 'auth_service' }
    ];

    const fluentdRes = await fetchJson(`http://localhost:${testPort}/v1/logs?environment=staging`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fluentdPayload
    });
    assert.strictEqual(fluentdRes.status, 200);
    assert.strictEqual(fluentdRes.data.status, 'SUCCESS');
    assert.strictEqual(fluentdRes.data.count, 2);

    // Ingest via POST /v1/logs (OTLP resourceLogs)
    const otlpPayload = {
      resourceLogs: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'order_service' } },
            { key: 'host.name', value: { stringValue: 'order-node-01' } },
            { key: 'deployment.environment', value: { stringValue: 'staging' } }
          ]
        },
        scopeLogs: [{
          logRecords: [
            {
              timeUnixNano: String(BigInt(Date.now()) * 1000000n),
              severityText: 'ERROR',
              body: { stringValue: 'Order payment failed: gateway timeout 504' }
            }
          ]
        }]
      }]
    };

    const otlpRes = await fetchJson(`http://localhost:${testPort}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: otlpPayload
    });
    assert.strictEqual(otlpRes.status, 200);
    assert.strictEqual(otlpRes.data.count, 1);
    console.log('✔ Test 6 Passed: Fluentd JSON and OTLP/logs ingested via POST /v1/logs');

    // Query GET /api/v2/logs/search without time bounds -> Assert HTTP 400
    const unboundedRes = await fetchJson(`http://localhost:${testPort}/api/v2/logs/search?q=Order`);
    assert.strictEqual(unboundedRes.status, 400, 'Expected HTTP 400 for unbounded log search');

    // Query GET /api/v2/logs/search with valid time bounds
    const nowIso = new Date().toISOString();
    const pastIso = new Date(Date.now() - 300000).toISOString();
    const searchRes = await fetchJson(`http://localhost:${testPort}/api/v2/logs/search?from=${pastIso}&to=${nowIso}&app_id=order_service`);
    assert.strictEqual(searchRes.status, 200);
    assert.ok(searchRes.data.items.length >= 1, 'Expected at least 1 order_service log');
    assert.ok(searchRes.data.items[0].message.includes('Order payment failed'));

    // Query GET /api/v2/logs/histogram
    const histRes = await fetchJson(`http://localhost:${testPort}/api/v2/logs/histogram?from=${pastIso}&to=${nowIso}`);
    assert.strictEqual(histRes.status, 200);
    assert.ok(histRes.data.buckets && histRes.data.buckets.length > 0);

    // Query GET /api/v2/logs/facets
    const facetsRes = await fetchJson(`http://localhost:${testPort}/api/v2/logs/facets?from=${pastIso}&to=${nowIso}`);
    assert.strictEqual(facetsRes.status, 200);
    assert.ok(facetsRes.data.apps && facetsRes.data.apps.length > 0);
    assert.ok(facetsRes.data.fingerprints && facetsRes.data.fingerprints.length > 0);

    console.log('✔ Test 7 Passed: /api/v2/logs search, histogram, and facets return correct schema');

  } finally {
    serverProc.kill('SIGTERM');
  }

  console.log('\n=============================================');
  console.log('🎉 ALL PHASE 3 LOG PIPELINE TESTS PASSED!');
  console.log('=============================================\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Log pipeline test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
