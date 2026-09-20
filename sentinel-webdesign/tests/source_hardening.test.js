const assert = require('assert');
const http = require('http');
const tokenProvider = require('../metrics_collection/real/dynatrace/token_provider');
const metricResolver = require('../metrics_collection/real/dynatrace/metric_resolver');
const { getTelemetrySource } = require('../metrics_collection/sources/telemetry_source');
const expiryEngine = require('../backend/config/expiryEngine');
const expiryStore = require('../database/expiry_store');
const { probeUrl } = require('../metrics_collection/real/probers/url_probe_collector');

async function runSourceHardeningTests() {
  console.log('=== RUNNING PHASE 5 SOURCE HARDENING TESTS ===\n');

  // --- Test 1: Dynatrace 30-Second Token Provider (T5.1) ---
  console.log('--- Test 1: Dynatrace Token Provider (Single-Flight Lock & 401 Retry) ---');
  tokenProvider.resetTokenState();
  process.env.DYNATRACE_API_TOKEN = 'dt0c01.SAMPLE_TEST_TOKEN_30S';

  // Concurrent invocations must join the same single-flight promise
  const [t1, t2, t3] = await Promise.all([
    tokenProvider.getApiToken(false),
    tokenProvider.getApiToken(false),
    tokenProvider.getApiToken(false)
  ]);

  assert(t1 && t1.length > 0, 'Token must be resolved');
  assert.strictEqual(t2, t1, 'Concurrent caller 2 receives identical token');
  assert.strictEqual(t3, t1, 'Concurrent caller 3 receives identical token');

  // 401 retry test
  let attempt = 0;
  const retryResult = await tokenProvider.executeWithTokenRetry(async (tok) => {
    attempt++;
    if (attempt === 1) {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    return `success-with-${tok}`;
  });

  assert.strictEqual(attempt, 2, 'Must have retried on 401');
  assert(retryResult.startsWith('success-with-'), 'Operation succeeded after 401 retry');
  console.log('✔ Test 1 Passed: Single-flight lock and automatic 401 retry verified');

  // --- Test 2: Dynatrace Metric-Name Drift Protection (T5.2) ---
  console.log('\n--- Test 2: Dynatrace Metric-Name Drift & Alias Resolver ---');
  const mockDescriptors = ['builtin:host.cpu.idle', 'builtin:host.mem.used.pct', 'builtin:service.errors.total.rate'];

  const mockDb = {
    alerts: [],
    addAlert(comp, sev, msg, stat, env) {
      this.alerts.push({ comp, sev, msg, stat, env });
    }
  };

  const resolved = metricResolver.resolveDescriptors(mockDescriptors, mockDb, 'staging');
  assert.strictEqual(resolved.get('host_cpu_avg_pct'), 'builtin:host.cpu.idle', 'Should resolve to matching candidate');
  assert.strictEqual(resolved.get('host_mem_avg_pct'), 'builtin:host.mem.used.pct', 'Should resolve to matching candidate');

  // An unresolvable metric must raise a DATA_UNAVAILABLE alert
  const badDescriptors = ['unrelated.metric'];
  metricResolver.resolveDescriptors(badDescriptors, mockDb, 'staging');
  const driftAlert = mockDb.alerts.find(a => a.msg && a.msg.includes('[DYNATRACE-DRIFT]'));
  assert(driftAlert, 'Must raise DATA_UNAVAILABLE alert when metric cannot be resolved');
  console.log('✔ Test 2 Passed: Metric aliases resolved; unresolvable metric raised alert');

  // --- Test 3: TelemetrySource Modular Interface (T5.3 / C8) ---
  console.log('\n--- Test 3: TelemetrySource Interface & Optional Dynatrace ---');
  const dynaSource = getTelemetrySource('dynatrace');
  const otlpSource = getTelemetrySource('otlp');
  const nodeSource = getTelemetrySource('node_exporter');

  assert(dynaSource, 'DynatraceTelemetrySource must be registered');
  assert(otlpSource, 'OtlpTelemetrySource must be registered');
  assert(nodeSource, 'NodeExporterTelemetrySource must be registered');
  assert(typeof dynaSource.isEnabled === 'function', 'isEnabled must be a function');
  console.log('✔ Test 3 Passed: TelemetrySource interface modularly abstracts all sources');

  // --- Test 4: Real Expiry Radar & Dynamic daysLeft (T5.4) ---
  console.log('\n--- Test 4: Dynamic Expiry Radar ---');
  const items = await expiryEngine.getAllExpiryItemsAsync();
  assert(Array.isArray(items), 'Items must be an array');
  assert(items.length >= 8, 'Must return at least canonical 8 items');

  const jenk = items.find(i => i.id === 'cert-jenk-tls');
  assert(jenk, 'Jenkins TLS cert item exists');
  assert(typeof jenk.daysLeft === 'number', 'daysLeft must be numeric');
  assert(['healthy', 'warning', 'critical'].includes(jenk.status), 'Status must be valid');

  const summary = expiryEngine.getExpirySummary();
  assert(typeof summary.total === 'number', 'Total must be numeric');
  assert(typeof summary.critical === 'number', 'Critical count must be numeric');
  console.log('✔ Test 4 Passed: Expiry radar computes daysLeft and statuses dynamically');

  // --- Test 5: Generic URL-Only Prober Collector (T5.5 / C6) ---
  console.log('\n--- Test 5: Generic URL-Only Prober Collector ---');
  // Start temporary mock HTTP server
  const testHttpServer = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', component: 'aquasec-scanner' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(r => testHttpServer.listen(0, '127.0.0.1', r));
  const testPort = testHttpServer.address().port;

  try {
    const probeResult = await probeUrl({
      url: `http://127.0.0.1:${testPort}/healthz`,
      component: 'aquasec',
      expectedStatus: 200,
      contentAssertion: 'aquasec-scanner'
    });

    assert.strictEqual(probeResult.status, 'HEALTHY');
    assert.strictEqual(probeResult.httpStatus, 200);
    assert.strictEqual(probeResult.assertionPassed, true);
    assert(typeof probeResult.latencyMs === 'number', 'Latency must be numeric');
    assert(probeResult.latencyMs >= 0, 'Latency must be positive');
    console.log(`✔ Test 5 Passed: Real URL probe measured: ${probeResult.latencyMs.toFixed(2)}ms latency, status=200`);
  } finally {
    testHttpServer.close();
  }

  console.log('\n=============================================');
  console.log('🎉 ALL PHASE 5 SOURCE HARDENING TESTS PASSED!');
  console.log('=============================================\n');
}

if (require.main === module) {
  runSourceHardeningTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ [TEST FAILED]', err);
      process.exit(1);
    });
}

module.exports = { runSourceHardeningTests };
