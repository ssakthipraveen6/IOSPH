/**
 * tests/vip_probe.test.js
 *
 * M3 Task 3.1 Acceptance Tests:
 * 1. Probes a local HTTPS server with a self-signed certificate.
 *    Verifies every layer timing > 0 (DNS, TCP, TLS, TTFB, total) and cert expiry days.
 * 2. Unreachable host gives DATA_UNAVAILABLE and null timings (never zeros).
 * 3. Batch collection emits standardized metrics (source: 'probe').
 * 4. Zero Math.random() in prober implementation.
 */

const assert = require('assert');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  probeVip,
  collectVipProbes,
  getLastVipProbes
} = require('../metrics_collection/real/probers/url_probe_collector');
const networkCollector = require('../metrics_collection/real/infrastructure/network_collector');

// Generate or resolve self-signed test certificate
function getTestTlsCredentials() {
  const tmpDir = path.resolve(__dirname, '../.runtime/test_tls');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const keyPath = path.join(tmpDir, 'test_key.pem');
  const certPath = path.join(tmpDir, 'test_cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath, 'utf8'),
      cert: fs.readFileSync(certPath, 'utf8')
    };
  }

  const opensslCandidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'
  ];

  for (const bin of opensslCandidates) {
    try {
      execSync(`"${bin}" req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=127.0.0.1" -days 30 -keyout "${keyPath}" -out "${certPath}"`, { stdio: 'pipe' });
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          key: fs.readFileSync(keyPath, 'utf8'),
          cert: fs.readFileSync(certPath, 'utf8')
        };
      }
    } catch (_) {}
  }

  // Self-contained fallback test credentials (valid for testing)
  throw new Error('Unable to generate self-signed certificate for test');
}

async function runTests() {
  console.log('[TEST] Starting M3 Task 3.1 VIP Prober Tests...');

  // --- Test Case 1: HTTPS server with self-signed certificate ---
  console.log('[TEST] Case 1: HTTPS probe records timings > 0 and cert expiry days...');
  const { key, cert } = getTestTlsCredentials();

  const httpsServer = https.createServer({ key, cert }, (req, res) => {
    // Add artificial tiny delay to ensure TTFB is clearly distinct
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'artifactory' }));
    }, 15);
  });

  await new Promise((resolve) => httpsServer.listen(0, '127.0.0.1', resolve));
  const port = httpsServer.address().port;

  try {
    const res = await probeVip({
      url: `https://127.0.0.1:${port}/api/system/ping`,
      productId: 'jfrog_artifactory',
      expectedStatus: 200,
      timeoutMs: 5000
    });

    assert.strictEqual(res.status, 'HEALTHY', 'Status should be HEALTHY');
    assert.strictEqual(res.httpStatus, 200, 'HTTP status should be 200');
    assert.strictEqual(res.source, 'probe', 'Source should be probe');
    assert.ok(res.probe_node, 'Probe node must be set');

    // Verify all timings > 0
    assert.ok(typeof res.dns_ms === 'number' && res.dns_ms > 0, `DNS ms should be > 0, got ${res.dns_ms}`);
    assert.ok(typeof res.tcp_ms === 'number' && res.tcp_ms > 0, `TCP ms should be > 0, got ${res.tcp_ms}`);
    assert.ok(typeof res.tls_ms === 'number' && res.tls_ms > 0, `TLS ms should be > 0, got ${res.tls_ms}`);
    assert.ok(typeof res.ttfb_ms === 'number' && res.ttfb_ms > 0, `TTFB ms should be > 0, got ${res.ttfb_ms}`);
    assert.ok(typeof res.total_ms === 'number' && res.total_ms > 0, `Total ms should be > 0, got ${res.total_ms}`);

    // Verify cert expiry days
    assert.ok(typeof res.cert_days_left === 'number' && res.cert_days_left >= 0, `Cert days left should be >= 0, got ${res.cert_days_left}`);
    assert.ok(res.protocol, 'Protocol should be reported');
    console.log(`✔ Case 1 Passed: DNS=${res.dns_ms}ms, TCP=${res.tcp_ms}ms, TLS=${res.tls_ms}ms, TTFB=${res.ttfb_ms}ms, Total=${res.total_ms}ms, CertDays=${res.cert_days_left}`);
  } finally {
    await new Promise((resolve) => httpsServer.close(resolve));
  }

  // --- Test Case 2: Unreachable host returns DATA_UNAVAILABLE with nulls (never zeros) ---
  console.log('[TEST] Case 2: Unreachable host returns DATA_UNAVAILABLE and null timings...');
  const unreachableRes = await probeVip({
    url: 'https://unreachable-host-nonexistent-12345.internal.corp:8443/ping',
    productId: 'bitbucket',
    timeoutMs: 1500
  });

  assert.strictEqual(unreachableRes.status, 'DATA_UNAVAILABLE', 'Status must be DATA_UNAVAILABLE');
  assert.strictEqual(unreachableRes.httpStatus, null, 'HTTP status must be null');
  assert.strictEqual(unreachableRes.dns_ms, null, 'DNS ms must be null (never 0)');
  assert.strictEqual(unreachableRes.tcp_ms, null, 'TCP ms must be null (never 0)');
  assert.strictEqual(unreachableRes.tls_ms, null, 'TLS ms must be null (never 0)');
  assert.strictEqual(unreachableRes.ttfb_ms, null, 'TTFB ms must be null (never 0)');
  assert.strictEqual(unreachableRes.total_ms, null, 'Total ms must be null (never 0)');
  assert.strictEqual(unreachableRes.cert_days_left, null, 'Cert days left must be null (never 0)');
  assert.ok(unreachableRes.error, 'Error message must explain reason');
  console.log('✔ Case 2 Passed: Unreachable host cleanly returned DATA_UNAVAILABLE with null timings.');

  // --- Test Case 3: Batch collection emits metrics to database ---
  console.log('[TEST] Case 3: Batch collection emits metrics to db...');
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('PONG');
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  try {
    const emittedMetrics = [];
    const mockDb = {
      addMetricBatch(batch) {
        emittedMetrics.push(...batch);
      }
    };

    const targets = [
      {
        url: `http://127.0.0.1:${httpPort}/health`,
        productId: 'cloudbees_jenkins',
        expectedStatus: 200
      }
    ];

    const results = await collectVipProbes(targets, mockDb, 'staging');
    assert.strictEqual(results.length, 1, 'Should return 1 probe result');
    assert.strictEqual(results[0].status, 'HEALTHY', 'Probe result should be HEALTHY');

    const metricNames = emittedMetrics.map(m => m.metricName);
    assert.ok(metricNames.includes('vip.dns_ms'), 'Must emit vip.dns_ms');
    assert.ok(metricNames.includes('vip.tcp_ms'), 'Must emit vip.tcp_ms');
    assert.ok(metricNames.includes('vip.ttfb_ms'), 'Must emit vip.ttfb_ms');
    assert.ok(metricNames.includes('vip.total_ms'), 'Must emit vip.total_ms');
    assert.ok(metricNames.includes('vip.status'), 'Must emit vip.status');

    emittedMetrics.forEach(m => {
      assert.strictEqual(m.source, 'probe', 'Emitted metric source must be probe');
      assert.strictEqual(m.env, 'staging', 'Emitted metric env must be staging');
    });

    const cached = getLastVipProbes('staging');
    assert.strictEqual(cached.length, 1, 'Cached probes should return the collected result');
    console.log('✔ Case 3 Passed: Batch probe metrics emitted with source: probe.');
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  // --- Test Case 4: Zero Math.random() in prober implementation ---
  console.log('[TEST] Case 4: Zero Math.random() in VIP prober code...');
  const proberFile = fs.readFileSync(
    path.resolve(__dirname, '../metrics_collection/real/probers/url_probe_collector.js'),
    'utf8'
  );
  assert.ok(!proberFile.includes('Math.random()'), 'url_probe_collector.js must not contain Math.random()');
  console.log('✔ Case 4 Passed: Zero Math.random() verified.');

  console.log('All M3 Task 3.1 VIP prober tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('VIP Prober Test Failure:', err);
  process.exit(1);
});
