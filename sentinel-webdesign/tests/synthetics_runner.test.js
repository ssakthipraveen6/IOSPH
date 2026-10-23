/**
 * tests/synthetics_runner.test.js
 *
 * Tests Golden Journey synthetic runner execution, cascading step skip on failure,
 * leader lock gating, span and metric recording, and zero Math.random() jitter.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JourneyRunner } = require('@sentinel/synthetics');

async function runTests() {
  console.log('[TEST] Starting @sentinel/synthetics runner tests...');

  // 1. Start a local HTTP canary server
  let step2Status = 200;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'UP' }));
    } else if (req.url === '/api/data') {
      res.writeHead(step2Status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: 42, error: step2Status !== 200 ? 'Server Fault' : null }));
    } else if (req.url === '/api/cleanup') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cleaned: true }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 2. Test 3-step successful journey
    console.log('[TEST] Case 1: 3-step successful HTTP journey writes spans and metrics...');
    const insertedSpans = [];
    const insertedMetrics = [];

    const mockClickhouse = {
      insertSpans: async (spans) => {
        insertedSpans.push(...spans);
        return spans.length;
      }
    };

    const mockDb = {
      addMetricBatch: (metrics, env) => {
        insertedMetrics.push(...metrics);
      }
    };

    const runner = new JourneyRunner({
      isLeaderCheck: () => true,
      clickhouseClient: mockClickhouse,
      dbManager: mockDb
    });

    const journey = {
      id: 'test_canary_journey',
      name: 'Test Canary Journey',
      base_url: baseUrl,
      interval_seconds: 30,
      steps: [
        {
          id: 'step_ping',
          name: 'Ping Health',
          layer: 'network',
          type: 'http',
          url: `${baseUrl}/health`,
          method: 'GET',
          assertions: { status: 200, body_contains: 'UP' }
        },
        {
          id: 'step_fetch',
          name: 'Fetch Data',
          layer: 'app',
          type: 'http',
          url: `${baseUrl}/api/data`,
          method: 'GET',
          assertions: { status: 200 }
        },
        {
          id: 'step_clean',
          name: 'Cleanup Call',
          layer: 'db',
          type: 'http',
          url: `${baseUrl}/api/cleanup`,
          method: 'GET',
          assertions: { status: 200 }
        }
      ]
    };

    const runResult = await runner.runJourney('test_product', journey, 'staging');
    assert.strictEqual(runResult.success, true, 'Run should succeed');
    assert.strictEqual(runResult.steps.length, 3, 'Should have 3 step results');
    assert.strictEqual(runResult.steps[0].status, 'OK');
    assert.strictEqual(runResult.steps[1].status, 'OK');
    assert.strictEqual(runResult.steps[2].status, 'OK');

    // Spans: 1 root + 3 steps = 4 spans
    assert.strictEqual(insertedSpans.length, 4, 'Should record 4 spans in ClickHouse');
    const stepSpanNames = insertedSpans.map(s => s.name);
    assert.ok(stepSpanNames.includes('step:step_ping'));
    assert.ok(stepSpanNames.includes('step:step_fetch'));
    assert.ok(stepSpanNames.includes('step:step_clean'));

    // Metrics emitted
    assert.ok(insertedMetrics.length >= 6, 'Should emit duration and success metrics for each step');
    const durationMetrics = insertedMetrics.filter(m => m.metricName === 'journey.step.duration_ms');
    assert.strictEqual(durationMetrics.length, 3, 'Should emit 3 duration metric points');
    console.log('✔ Case 1 Passed: 3 steps executed, 4 spans recorded, metrics emitted.');

    // 3. Test failure cascading to SKIPPED
    console.log('[TEST] Case 2: Failing step cascades subsequent steps to SKIPPED...');
    step2Status = 500; // Induce failure on step 2
    insertedSpans.length = 0;
    insertedMetrics.length = 0;

    const failedRun = await runner.runJourney('test_product', journey, 'staging');
    assert.strictEqual(failedRun.success, false, 'Run should fail');
    assert.strictEqual(failedRun.failingStepId, 'step_fetch', 'Should pinpoint failing step');
    assert.strictEqual(failedRun.steps[0].status, 'OK', 'Step 1 should pass');
    assert.strictEqual(failedRun.steps[1].status, 'FAILED', 'Step 2 should fail');
    assert.strictEqual(failedRun.steps[2].status, 'SKIPPED', 'Step 3 should be cascaded to SKIPPED');
    assert.strictEqual(failedRun.steps[2].durationMs, 0, 'Skipped step duration should be 0');
    console.log('✔ Case 2 Passed: Step failure cascading to SKIPPED verified.');

    // 4. Test leader-only execution gating
    console.log('[TEST] Case 3: Runner skips execution when leaderLock.isLeader() is false...');
    const nonLeaderRunner = new JourneyRunner({
      isLeaderCheck: () => false
    });
    const skippedRun = await nonLeaderRunner.runJourney('test_product', journey, 'staging');
    assert.strictEqual(skippedRun.skipped, true, 'Run should be skipped');
    assert.strictEqual(skippedRun.reason, 'NOT_LEADER', 'Reason should be NOT_LEADER');
    console.log('✔ Case 3 Passed: Non-leader node gracefully skips journey execution.');

    // 5. Test zero Math.random() in synthetics package
    console.log('[TEST] Case 4: Zero Math.random() in @sentinel/synthetics...');
    const syntheticsDir = path.resolve(__dirname, '../synthetics');
    function checkDirForMathRandom(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDirForMathRandom(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.strictEqual(content.includes('Math.random'), false, `Found Math.random() in ${entry.name}`);
        }
      }
    }
    checkDirForMathRandom(syntheticsDir);
    console.log('✔ Case 4 Passed: Zero Math.random() detected across synthetics package.');

  } finally {
    server.close();
  }

  console.log('All synthetics runner tests passed successfully!\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
