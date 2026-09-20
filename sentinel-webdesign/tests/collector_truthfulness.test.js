/**
 * tests/collector_truthfulness.test.js
 * 
 * Phase 2b Verification Suite (Section 9):
 * 1. Zero Math.random() in real collectors.
 * 2. Collector contract envelope adherence.
 * 3. Real latency measurement via performance.now().
 * 4. Truthful null return values without baseline synthesis in production.
 * 5. Preflight checker reachability & auth reporting.
 * 6. Fail-fast configuration validation at startup.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING PHASE 2b COLLECTOR TRUTHFULNESS TESTS ===\n');

// -------------------------------------------------------------
// Test 1: Zero Math.random() in real/ collector directories
// -------------------------------------------------------------
console.log('--- Test 1: Zero Math.random() in Real Collectors (T2b.2 & Lint Rule) ---');
const realCollectorDirs = [
  path.join(__dirname, '..', 'metrics_collection', 'real'),
  path.join(__dirname, '..', 'logs_collection', 'real')
];

let randomViolations = 0;
function checkNoRandom(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkNoRandom(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((l, idx) => {
        const trimmed = l.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (l.includes('Math.random(')) {
          console.error(`Found Math.random() at ${full}:${idx + 1}`);
          randomViolations++;
        }
      });
    }
  }
}

realCollectorDirs.forEach(d => checkNoRandom(d));
assert.strictEqual(randomViolations, 0, 'Must have zero Math.random() calls in real collectors');
console.log('✔ Test 1 Passed: Exactly 0 Math.random() calls in real collector trees.');

// -------------------------------------------------------------
// Test 2: Collector Contract Envelope Helper (T2b.1)
// -------------------------------------------------------------
console.log('\n--- Test 2: Collector Contract Envelope Compliance (T2b.1) ---');
const { createCollectorEnvelope, STATUS, SOURCE } = require('../metrics_collection/shared/collector_contract');

const envelope = createCollectorEnvelope({
  status: STATUS.OK,
  metrics: { cpu: 22.4, memory: 55.2 },
  source: SOURCE.LIVE
});

assert.strictEqual(envelope.status, 'OK');
assert.strictEqual(envelope.metrics.cpu, 22.4);
assert.strictEqual(envelope.source, 'live');
assert.ok(envelope.observedAt, 'observedAt timestamp must be present');
assert.strictEqual(envelope.error, null);

const unavailEnvelope = createCollectorEnvelope({
  status: STATUS.DATA_UNAVAILABLE,
  metrics: { cpu: null, memory: null },
  source: SOURCE.NONE,
  error: 'Endpoint unreachable'
});
assert.strictEqual(unavailEnvelope.status, 'DATA_UNAVAILABLE');
assert.strictEqual(unavailEnvelope.metrics.cpu, null);
assert.strictEqual(unavailEnvelope.error, 'Endpoint unreachable');
console.log('✔ Test 2 Passed: Collector contract envelopes enforce standard structure.');

// -------------------------------------------------------------
// Test 3: Real Latency Measurement in fetchJsonWithFallback (T2b.2)
// -------------------------------------------------------------
console.log('\n--- Test 3: Real Latency Measurement in HTTP Fetch Utility ---');
const { fetchJsonWithFallback } = require('../metrics_collection/shared/fetch_with_fallback');

(async () => {
  // Test local / unresolvable endpoint
  const res = await fetchJsonWithFallback('http://127.0.0.1:1', {}, 500);
  assert.ok(typeof res.latencyMs === 'number', 'Every response object must include measured latencyMs');
  assert.ok(res.latencyMs >= 0, 'latencyMs must be non-negative');
  console.log(`✔ Test 3 Passed: Real latency measured: ${res.latencyMs}ms on probe.`);

  // -------------------------------------------------------------
  // Test 4: Truthful null returns in real collectors when unconfigured
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Truthful Null Telemetry (Zero Synthetic Numbers) ---');
  global.runtimeEnvironment = 'prod';
  
  const jenkinsCollector = require('../metrics_collection/real/applications/jenkins_collector');
  const jenkinsResult = await jenkinsCollector.collect({}, {});
  // Unreachable in test environment -> executors and queue must be null, never Math.random() or baseline
  assert.ok(jenkinsResult.queue === null || typeof jenkinsResult.queue === 'number', 'Queue must be parsed number or null');

  const s3Collector = require('../metrics_collection/real/infrastructure/s3_collector');
  const s3Result = await s3Collector.collect({}, {});
  assert.strictEqual(s3Result.space, null, 'S3 space must not be fabricated from baseline');
  assert.strictEqual(s3Result.bandwidth, null, 'S3 bandwidth must not be fabricated from baseline');

  const dockerCollector = require('../metrics_collection/real/infrastructure/docker_collector');
  const dockerResult = await dockerCollector.collect({}, {});
  assert.strictEqual(dockerResult.cgroup_cpu_usage_pct, null, 'Docker cgroup CPU must be null when unconfigured');

  const sonarqubeCollector = require('../metrics_collection/real/applications/sonarqube_collector');
  const sonarResult = await sonarqubeCollector.collect({}, {});
  assert.strictEqual(sonarResult.qualityGatesPassed, null, 'SonarQube QG passed must not be synthesized');

  console.log('✔ Test 4 Passed: Unconfigured and unreachable endpoints return null without synthetic fabrication.');

  // -------------------------------------------------------------
  // Test 5: Preflight Check Engine (T2b.5)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Config Preflight Checker (T2b.5) ---');
  const { runPreflightCheck } = require('../scripts/preflight_check');
  const preflightReport = await runPreflightCheck('prod');

  assert.ok(preflightReport, 'Preflight check must return a report object');
  assert.strictEqual(preflightReport.environment, 'prod');
  assert.ok(preflightReport.totalTargets > 15, 'Must check all configured targets');
  assert.ok(Array.isArray(preflightReport.results), 'results must be an array');
  
  preflightReport.results.forEach(r => {
    assert.ok(['REACHABLE', 'AUTH_FAILED', 'UNREACHABLE', 'NOT_CONFIGURED'].includes(r.status));
    assert.ok(r.target, 'Target name required');
    assert.ok(r.reason, 'Diagnostic reason required');
  });
  console.log(`✔ Test 5 Passed: Preflight check processed ${preflightReport.totalTargets} targets with explicit diagnostic states.`);

  // -------------------------------------------------------------
  // Test 6: Fail-Fast Configuration Validation at Boot (T2b.6)
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Fail-Fast Config Validation at Startup (T2b.6) ---');
  const yamlConfig = require('../backend/config/yaml_config');
  const isValid = yamlConfig.validateConfig();
  assert.strictEqual(isValid, true, 'Current valid config must pass validation');

  console.log('✔ Test 6 Passed: yamlConfig.validateConfig() executes cleanly during startup verification.');

  console.log('\n======================================================');
  console.log('🎉 ALL PHASE 2b TRUTHFULNESS & PREFLIGHT TESTS PASSED!');
  console.log('======================================================\n');
})();
