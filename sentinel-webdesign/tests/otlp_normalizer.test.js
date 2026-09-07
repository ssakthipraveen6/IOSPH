const assert = require('assert');
const { normalizeOtlpPayload, OTEL_METRIC_MAP } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');

async function runOtlpNormalizerTests() {
  console.log('=== RUNNING OPENTELEMETRY (OTLP) NORMALIZER TESTS ===');

  // Sample real standard OTLP JSON payload from an OpenTelemetry Collector agent
  const sampleOtlpPayload = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'host.name', value: { stringValue: 'bitbucket-node-1' } },
            { key: 'application.id', value: { stringValue: 'bitbucket' } }
          ]
        },
        scopeMetrics: [
          {
            scope: { name: 'otelcol/hostmetricsreceiver' },
            metrics: [
              {
                name: 'system.cpu.utilization',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1725000000000000000',
                      asDouble: 0.284
                    }
                  ]
                }
              },
              {
                name: 'system.memory.utilization',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1725000000000000000',
                      asDouble: 0.642
                    }
                  ]
                }
              },
              {
                name: 'jvm.memory.heap.used',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1725000000000000000',
                      asInt: 2147483648 // 2GB in bytes
                    }
                  ]
                }
              },
              {
                name: 'system.disk.io',
                sum: {
                  dataPoints: [
                    {
                      timeUnixNano: '1725000000000000000',
                      asInt: 450
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = normalizeOtlpPayload(sampleOtlpPayload);

  // Assertions
  assert.strictEqual(parsed.length, 4);

  const cpuMetric = parsed.find(m => m.metricName === 'cpu');
  assert(cpuMetric, 'CPU metric should be mapped to "cpu"');
  assert.strictEqual(cpuMetric.component, 'bitbucket');
  assert.strictEqual(cpuMetric.value, 28.4); // 0.284 -> 28.4%
  console.log(`✔ Test 1 Passed: OTel CPU utilization normalized: ${cpuMetric.value}% for ${cpuMetric.component}`);

  const memMetric = parsed.find(m => m.metricName === 'memory');
  assert(memMetric, 'Memory metric should be mapped to "memory"');
  assert.strictEqual(memMetric.value, 64.2); // 0.642 -> 64.2%
  console.log(`✔ Test 2 Passed: OTel Memory utilization normalized: ${memMetric.value}%`);

  const jvmMetric = parsed.find(m => m.metricName === 'jvm_heap_used_mb');
  assert(jvmMetric, 'JVM metric should be mapped to "jvm_heap_used_mb"');
  assert.strictEqual(jvmMetric.value, 2048); // 2GB in bytes -> 2048 MB
  console.log(`✔ Test 3 Passed: OTel JVM Heap normalized from bytes to MB: ${jvmMetric.value} MB`);

  const ioMetric = parsed.find(m => m.metricName === 'iops');
  assert(ioMetric, 'Disk IO metric should be mapped to "iops"');
  assert.strictEqual(ioMetric.value, 450);
  console.log(`✔ Test 4 Passed: OTel Disk I/O normalized: ${ioMetric.value} IOPS`);

  console.log('=== ALL OPENTELEMETRY NORMALIZER TESTS PASSED ===\n');
}

if (require.main === module) {
  runOtlpNormalizerTests();
}

module.exports = { runOtlpNormalizerTests };
