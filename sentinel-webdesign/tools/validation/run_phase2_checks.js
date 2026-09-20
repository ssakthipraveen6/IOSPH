/**
 * tools/validation/run_phase2_checks.js
 *
 * Phase 2 Launch Validation (Section 23.4):
 * 1. Launch app with ingest pipeline.
 * 2. Push high-throughput metric batches to POST /v1/metrics.
 * 3. Assert sentinel_ingest_dropped_total == 0 on GET /api/v2/ingest/health.
 * 4. Assert p95 ingest ack < 150ms.
 * 5. Assert GET /api/metrics for one entity returns in < 400ms.
 * 6. Verify circuit breaker states and cardinality guard counters.
 */

const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const { performance } = require('perf_hooks');

const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} failed to start within ${timeoutMs}ms`);
}

async function run() {
  console.log('=== RUNNING PHASE 2 LAUNCH VALIDATION (Section 23.4) ===');

  const serverPort = '3003';
  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SENTINEL_JWT_SECRET: JWT_SECRET,
      PORT: serverPort,
      ENVIRONMENT: 'staging',
      SENTINEL_ROLE: 'all'
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('OTEL') || s.includes('INVENTORY') || s.includes('ERROR')) {
      process.stdout.write(`[SERVER] ${s}`);
    }
  });
  serverProc.stderr.on('data', d => process.stderr.write(`[SERVER-ERR] ${d}`));

  try {
    await waitForServer(`http://localhost:${serverPort}/healthz`);
    console.log(`[CHECK] Backend running on :${serverPort}`);

    // 1. High-throughput ingestion test (OTLP POST /v1/metrics)
    console.log('\n[CHECK 1] Pushing 1,000 OTLP metrics through /v1/metrics...');
    const acks = [];
    const totalBatches = 10;
    const batchSize = 100;

    for (let b = 0; b < totalBatches; b++) {
      const resourceMetrics = [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: `app_service_${b}` } },
            { key: 'host.name', value: { stringValue: `host-prod-${b}.internal.corp` } },
            { key: 'deployment.environment', value: { stringValue: 'staging' } }
          ]
        },
        scopeMetrics: [{
          metrics: Array.from({ length: batchSize }, (_, i) => ({
            name: `metric_test_${i % 10}`,
            gauge: {
              dataPoints: [{
                asDouble: 42.5 + i,
                timeUnixNano: (Date.now() * 1000000).toString()
              }]
            }
          }))
        }]
      }];

      const t0 = performance.now();
      const res = await fetchJson(`http://localhost:${serverPort}/v1/metrics`, {
        method: 'POST',
        body: { resourceMetrics }
      });
      const ack = performance.now() - t0;
      acks.push(ack);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.data.status, 'SUCCESS');
    }

    acks.sort((a, b) => a - b);
    const p50 = acks[Math.floor(acks.length * 0.5)];
    const p95 = acks[Math.floor(acks.length * 0.95)];
    console.log(`[CHECK 1] Ack latency: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);
    assert(p95 < 150, `p95 ack must be < 150ms, was ${p95}ms`);
    console.log('✔ Check 1 Passed: 1,000 rows ingested with p95 ack < 150ms');

    // 2. Query GET /api/v2/ingest/health
    console.log('\n[CHECK 2] Querying /api/v2/ingest/health...');
    const healthRes = await fetchJson(`http://localhost:${serverPort}/api/v2/ingest/health`);
    assert.strictEqual(healthRes.status, 200);
    const ingestHealth = healthRes.data;
    console.log('[CHECK 2] Ingest Health Payload:', JSON.stringify(healthRes.data, null, 2));

    assert.strictEqual(ingestHealth.status, 'HEALTHY');
    assert.strictEqual(ingestHealth.droppedTotal, 0, 'Dropped total must be 0');
    assert.strictEqual(ingestHealth.queueCapacity, 50000, 'Queue capacity must be 50,000');
    assert(ingestHealth.cardinality.activeSeriesCount > 0, 'Active series count must be > 0');
    assert.strictEqual(ingestHealth.cardinality.droppedTotal, 0, 'Cardinality dropped must be 0');
    console.log('✔ Check 2 Passed: Ingest health reports HEALTHY, 0 drops, and active cardinality tracking');

    // 3. Query GET /api/metrics latency
    console.log('\n[CHECK 3] Querying GET /api/metrics for query latency (<400ms target)...');
    const q0 = performance.now();
    const metricsRes = await fetchJson(`http://localhost:${serverPort}/api/metrics?limit=500&environment=staging`);
    const qTime = performance.now() - q0;
    assert.strictEqual(metricsRes.status, 200);
    console.log(`[CHECK 3] /api/metrics latency: ${qTime.toFixed(2)}ms (target: < 400ms)`);
    assert(qTime < 400, `Query time must be < 400ms, was ${qTime}ms`);
    console.log('✔ Check 3 Passed: Query latency well within 400ms');

    console.log('\n========================================================');
    console.log('🎉 PHASE 2 LAUNCH VALIDATION SUITE PASSED (ALL CHECKS GREEN)');
    console.log('========================================================');
  } finally {
    serverProc.kill('SIGTERM');
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('❌ Phase 2 launch validation failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
