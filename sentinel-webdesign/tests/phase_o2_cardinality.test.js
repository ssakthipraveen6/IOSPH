/**
 * tests/phase_o2_cardinality.test.js
 *
 * Acceptance test for Phase O2:
 * - O2.9: Process cardinality guard: keep full-resolution process metrics only for the top 10
 *   per host and manifest-named processes; aggregate the rest into 'other'.
 *   Acceptance: 200 processes in -> <= 10 + named + other stored.
 */

const assert = require('assert');
const { normalizeOtlpPayload, applyProcessCardinalityGuard } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');

async function run() {
  console.log('--- Phase O2: Process Cardinality Guard Tests ---');

  // Build an OTLP payload with 200 distinct processes
  const dataPoints = [];
  const namedProcesses = ['java', 'nginx'];

  // Process 1: java (named, moderate CPU 15.0)
  dataPoints.push({
    asDouble: 15.0,
    attributes: [{ key: 'process.executable.name', value: { stringValue: 'java' } }, { key: 'process.pid', value: { intValue: 1001 } }]
  });

  // Process 2: nginx (named, low CPU 2.5)
  dataPoints.push({
    asDouble: 2.5,
    attributes: [{ key: 'process.executable.name', value: { stringValue: 'nginx' } }, { key: 'process.pid', value: { intValue: 1002 } }]
  });

  // Processes 3-200: worker_003 to worker_200 with descending CPU values
  for (let i = 3; i <= 200; i++) {
    const val = parseFloat((200 - i + 0.5).toFixed(1)); // values from 197.5 down to 0.5
    dataPoints.push({
      asDouble: val,
      attributes: [
        { key: 'process.executable.name', value: { stringValue: `worker_${String(i).padStart(3, '0')}` } },
        { key: 'process.pid', value: { intValue: 2000 + i } }
      ]
    });
  }

  assert.strictEqual(dataPoints.length, 200, 'Must have exactly 200 input processes');

  const payload = {
    resourceMetrics: [{
      resource: {
        attributes: [
          { key: 'host.name', value: { stringValue: 'app-host-01' } },
          { key: 'application.id', value: { stringValue: 'payments-app' } }
        ]
      },
      scopeMetrics: [{
        metrics: [{
          name: 'process.cpu.utilization',
          gauge: { dataPoints }
        }]
      }]
    }]
  };

  const normalized = normalizeOtlpPayload(payload, { namedProcesses });

  // Acceptance: 200 processes in -> <= 10 + named + other stored
  // Here named = 2 ('java', 'nginx'). Top 10 non-named processes will be worker_003 to worker_012.
  // Plus 1 aggregated 'other' row. Total = 2 (named) + 10 (top) + 1 (other) = 13 rows.
  const maxAllowed = 10 + namedProcesses.length + 1;
  assert(normalized.length <= maxAllowed,
    `Stored rows (${normalized.length}) must be <= 10 + named (${namedProcesses.length}) + other = ${maxAllowed}`);

  const processNames = normalized.map(r => r.attributes && r.attributes['process.executable.name']);

  // Named processes must be kept
  assert(processNames.includes('java'), 'Named process "java" must be kept at full resolution');
  assert(processNames.includes('nginx'), 'Named process "nginx" must be kept at full resolution');

  // 'other' aggregated process must exist
  assert(processNames.includes('other'), 'Aggregated "other" process row must be present');

  const otherRow = normalized.find(r => r.attributes && r.attributes['process.executable.name'] === 'other');
  assert(otherRow.value > 0, '"other" aggregated process must have positive sum value');

  console.log(`  ✓ O2.9: 200 processes in -> ${normalized.length} stored (<= 10 + 2 named + 1 other)`);
  console.log('All Phase O2 Process Cardinality tests passed!\n');
}

run().catch(err => {
  console.error('[TEST FAILURE]', err);
  process.exit(1);
});
