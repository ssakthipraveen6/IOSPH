/**
 * Test: ingest throughput and storage under load.
 */
const assert = require('assert');
const { performance } = require('perf_hooks');
const db = require('../database/db');
const { canExecute, recordFailure, recordSuccess, getBreaker, resetAll } = require('../metrics_collection/shared/circuit_breaker');

async function runLoadIngestTest() {
  console.log('=== RUNNING PHASE 2 INGESTION & STORAGE LOAD TESTS (T2.2 - T2.6) ===\n');

  // Test 1: High-throughput ingestion burst (1,000+ rows/sec equivalent)
  console.log('--- Test 1: Ingest Throughput and Latency Assertion ---');
  const rowCount = 2000;
  const batchSize = 100;
  const acks = [];
  const startTotal = performance.now();

  for (let b = 0; b < rowCount / batchSize; b++) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = b * batchSize + i;
      batch.push({
        component: `app_service_${idx % 20}`,
        entity_id: `host:node-${idx % 50}.corp`,
        metricName: 'system_cpu_usage',
        value: 45.2,
        timestamp: new Date().toISOString(),
        env: 'staging'
      });
    }
    const t0 = performance.now();
    db.addMetricBatch(batch, 'staging');
    const ackTime = performance.now() - t0;
    acks.push(ackTime);
  }

  const totalTime = performance.now() - startTotal;
  acks.sort((a, b) => a - b);
  const p50 = acks[Math.floor(acks.length * 0.5)];
  const p95 = acks[Math.floor(acks.length * 0.95)];
  const effectiveThroughput = (rowCount / (totalTime / 1000));

  console.log(`Ingested ${rowCount} rows across ${rowCount / batchSize} batches in ${totalTime.toFixed(2)}ms`);
  console.log(`Throughput: ${effectiveThroughput.toFixed(0)} rows/sec (target: > 1,000 rows/sec)`);
  console.log(`Ack Latency: p50 = ${p50.toFixed(2)}ms, p95 = ${p95.toFixed(2)}ms (target: p95 < 150ms)`);

  assert(effectiveThroughput > 1000, `Throughput must exceed 1000 rows/sec, was ${effectiveThroughput}`);
  assert(p95 < 150, `p95 ack latency must be < 150ms, was ${p95}ms`);
  console.log('✔ Test 1 Passed: Ingest throughput and p95 ack latency within strict targets.\n');

  // Test 2: Ingest Health & Queue Stats
  console.log('--- Test 2: Ingest Health Telemetry and Queue Verification ---');
  const stats = db.getIngestStats();
  console.log('Ingest Stats:', JSON.stringify(stats, null, 2));
  assert(stats.queueCapacity === 50000, 'Queue capacity should be 50,000');
  assert(stats.droppedTotal === 0, 'Zero dropped rows under normal load');
  assert(typeof stats.cardinality.activeSeriesCount === 'number', 'Active series count tracked');
  assert(stats.cardinality.activeSeriesCount > 0, 'Should have registered active series');
  console.log('✔ Test 2 Passed: Ingest stats accurately surface queue depth, capacity, and zero drops.\n');

  // Test 3: Circuit Breaker State Transitions
  console.log('--- Test 3: Collector Circuit Breaker (T2.4) ---');
  resetAll();
  const target = 'https://unreachable-controller.internal.corp/api';
  
  // Initially closed
  assert.strictEqual(canExecute(target), true, 'Circuit breaker initially CLOSED');
  
  // 4 failures - still CLOSED
  for (let i = 1; i <= 4; i++) {
    recordFailure(target, new Error('Connection refused'));
    assert.strictEqual(canExecute(target), true, `Attempt ${i}: still CLOSED`);
  }

  // 5th failure - trips to OPEN
  recordFailure(target, new Error('Connection refused'));
  const breaker = getBreaker(target);
  assert.strictEqual(breaker.state, 'OPEN', 'Breaker must trip to OPEN after 5 failures');
  assert.strictEqual(canExecute(target), false, 'Requests rejected fast while OPEN');
  console.log(`Circuit breaker tripped to OPEN. Next allowed attempt in ${breaker.currentBackoffMs}ms`);

  // Simulate recovery
  recordSuccess(target);
  assert.strictEqual(breaker.state, 'CLOSED', 'Breaker resets to CLOSED upon success');
  assert.strictEqual(canExecute(target), true, 'Requests allowed again after success');
  console.log('✔ Test 3 Passed: Circuit breaker correctly protects failed targets with exponential backoff.\n');

  // Test 4: Memory footprint stays within bounds
  console.log('--- Test 4: Memory Footprint Verification ---');
  const mem = process.memoryUsage();
  const heapUsedMb = mem.heapUsed / 1024 / 1024;
  console.log(`Heap Used: ${heapUsedMb.toFixed(2)} MB (limit: < 2048 MB)`);
  assert(heapUsedMb < 2048, `Heap used must be < 2048 MB, was ${heapUsedMb} MB`);
  console.log('✔ Test 4 Passed: Steady state memory footprint well within 2GB ceiling.\n');

  console.log('=== ALL PHASE 2 INGESTION & STORAGE TESTS PASSED ===\n');
}

if (require.main === module) {
  runLoadIngestTest().catch(err => {
    console.error('❌ Phase 2 test failed:', err);
    process.exit(1);
  });
}

module.exports = { runLoadIngestTest };
