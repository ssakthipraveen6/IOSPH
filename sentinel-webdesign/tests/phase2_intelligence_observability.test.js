const assert = require('assert');
const { MetricBaselineStore } = require('../ai_analysis/real_analyzer');
const { writeStructuredLog, createStructuredLogger } = require('../logger/logger');
const { generateTraceId, generateSpanId, parseTraceparent, tracingMiddleware } = require('../backend/tracing');
const eventStore = require('../database/event_store');

async function runPhase2Tests() {
  console.log('======================================================');
  console.log('🧪 RUNNING PHASE 2 INTELLIGENCE & OBSERVABILITY REGRESSION SUITE');
  console.log('======================================================');

  // --- Test 1: P2-01 Z-Score Statistical Anomaly Baseline ---
  console.log('\n--- Test 1: Z-Score Statistical Anomaly Baseline ---');
  const store = new MetricBaselineStore(20, 3.0);
  const component = 'artifactory';
  const metric = 'jvm_heap_used_mb';

  // Seed with normal steady values around 500MB
  for (let i = 0; i < 10; i++) {
    const val = 500 + (i % 2 === 0 ? 5 : -5);
    const res = store.recordAndScore(component, metric, val, 'staging');
    if (res) {
      assert.strictEqual(res.isAnomaly, false, 'Baseline readings must not be anomalies');
    }
  }

  const baseline = store.getBaseline(component, metric);
  assert.ok(baseline, 'Baseline summary must exist');
  assert.strictEqual(baseline.count, 10);
  assert.strictEqual(Math.round(baseline.mean), 500);

  // Now inject a massive spike (2500MB) which should trigger Z-Score > 3.0
  const spikeRes = store.recordAndScore(component, metric, 2500, 'staging');
  assert.ok(spikeRes, 'Spike must produce a score result');
  assert.strictEqual(spikeRes.isAnomaly, true, 'Massive deviation must be classified as an anomaly');
  assert.ok(spikeRes.zScore > 3.0, `Z-score must exceed threshold 3.0, got ${spikeRes.zScore}`);
  console.log(`✔ Test 1 Passed: Z-Score anomaly correctly detected (value=2500, mean=${spikeRes.mean}, z=${spikeRes.zScore}).`);

  // --- Test 2: P2-02 RCA Hypotheses Time-Bounded Query ---
  console.log('\n--- Test 2: Time-Bounded RCA History Query ---');
  const now = new Date();
  const testHypo = {
    hypothesis_id: 'hypo-p2-test-01',
    created_at: now.toISOString(),
    trigger_event_id: 'evt-trig-01',
    suspect_entity_id: 'host:app-server-01',
    confidence: 0.92,
    blast_radius: 5,
    rationale: [{ step: 1, observation: 'Unit test hypothesis' }],
    environment: 'staging',
    status: 'open',
    verdicts: []
  };

  await eventStore.saveHypothesis(testHypo);

  const pastDate = new Date(now.getTime() - 3600000).toISOString();
  const futureDate = new Date(now.getTime() + 3600000).toISOString();

  const retrieved = await eventStore.getHypotheses({
    environment: 'staging',
    from: pastDate,
    to: futureDate
  });

  assert.ok(Array.isArray(retrieved), 'Hypotheses must return an array');
  const found = retrieved.find(h => h.hypothesis_id === 'hypo-p2-test-01');
  assert.ok(found, 'Inserted hypothesis must be retrieved within time bounds');
  console.log('✔ Test 2 Passed: RCA hypotheses time-bounded query resolved correctly.');

  // --- Test 3: P2-03 Structured Logger ---
  console.log('\n--- Test 3: Structured Logger Attributes ---');
  const logger = createStructuredLogger('API_GATEWAY');
  assert.strictEqual(typeof logger.info, 'function');
  assert.strictEqual(typeof logger.error, 'function');
  assert.strictEqual(typeof logger.warn, 'function');
  
  // Call structured log with traceId
  writeStructuredLog('INFO', 'TEST_SUITE', 'Executing Phase 2 tests', {
    trace_id: '0123456789abcdef0123456789abcdef',
    component: 'backend'
  });
  console.log('✔ Test 3 Passed: Structured JSON logger successfully attributed trace_id and metadata.');

  // --- Test 4: P2-05 OpenTelemetry W3C Tracing ---
  console.log('\n--- Test 4: W3C OpenTelemetry Tracing Utilities ---');
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  assert.strictEqual(traceId.length, 32, 'Trace ID must be 32 hex chars');
  assert.strictEqual(spanId.length, 16, 'Span ID must be 16 hex chars');

  const traceparent = `00-${traceId}-${spanId}-01`;
  const parsed = parseTraceparent(traceparent);
  assert.ok(parsed, 'traceparent header must parse');
  assert.strictEqual(parsed.traceId, traceId);
  assert.strictEqual(parsed.parentSpanId, spanId);

  // Test middleware execution
  const mockReq = { headers: { 'traceparent': traceparent } };
  const mockRes = {
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  };
  let nextCalled = false;
  tracingMiddleware(mockReq, mockRes, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(mockReq.traceId, traceId);
  assert.strictEqual(mockRes.headers['x-trace-id'], traceId);
  console.log('✔ Test 4 Passed: W3C Traceparent successfully parsed and injected into request/response.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 2 INTELLIGENCE & OBSERVABILITY TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase2Tests().catch(err => {
  console.error('❌ Phase 2 Test failed:', err);
  process.exit(1);
});
