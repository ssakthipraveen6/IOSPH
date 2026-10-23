/**
 * Test: hosts and services are discovered from OTLP data.
 */
const assert = require('assert');
const inventory = require('../inventory');

async function runInventoryDiscoveryTests() {
  console.log('=== RUNNING INVENTORY OTLP AUTO-DISCOVERY TESTS (T1.3) ===');

  // Reset inventory state for clean testing
  inventory.store.clear();

  // Test 1: Empty initial state
  const initial = await inventory.getEntities();
  assert.strictEqual(initial.total, 0, 'Initial inventory must be empty');
  console.log('✔ Test 1 Passed: Initial inventory store is empty.');

  // Test 2: Ingest synthetic OTLP payload from unknown host
  const syntheticPayload = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'host.name', value: { stringValue: 'newhost-01.corp' } },
            { key: 'service.name', value: { stringValue: 'cloudbees_jenkins' } },
            { key: 'environment', value: { stringValue: 'staging' } },
            { key: 'cloud.region', value: { stringValue: 'emea' } },
            { key: 'os.type', value: { stringValue: 'windows' } },
            { key: 'host.arch', value: { stringValue: 'amd64' } }
          ]
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'system.cpu.utilization',
                gauge: {
                  dataPoints: [
                    { timeUnixNano: String(Date.now() * 1000000), asDouble: 42.5 }
                  ]
                }
              }
            ]
          }
        ]
      }
    ]
  };

  const registered = await inventory.sources.otlp.processOtlpPayload(syntheticPayload);
  assert.ok(registered.length >= 2, 'Must register at least host and service/app entities');
  console.log(`✔ Test 2 Passed: OTLP payload processed, registered ${registered.length} entities.`);

  // Test 3: Query host entity
  const hosts = await inventory.getEntities({ kind: 'host' });
  assert.strictEqual(hosts.total, 1, 'Expected exactly 1 host entity');
  const host = hosts.entities[0];
  assert.strictEqual(host.entity_id, 'host:newhost-01.corp');
  assert.strictEqual(host.name, 'newhost-01.corp');
  assert.strictEqual(host.app_id, 'cloudbees_jenkins');
  assert.strictEqual(host.environment, 'staging');
  assert.strictEqual(host.source, 'otlp');
  console.log('✔ Test 3 Passed: Host entity accurately discovered and attributes verified:', host.entity_id);

  // Test 4: Query application entity
  const apps = await inventory.getEntities({ kind: 'app' });
  assert.strictEqual(apps.total, 1, 'Expected exactly 1 app entity');
  const app = apps.entities[0];
  assert.strictEqual(app.entity_id, 'app:cloudbees_jenkins');
  assert.strictEqual(app.name, 'cloudbees_jenkins');
  console.log('✔ Test 4 Passed: App entity accurately created:', app.entity_id);

  // Test 5: Graph relationships (runs_on edge between host and app)
  const hostWithEdges = await inventory.getEntityById('host:newhost-01.corp');
  assert.ok(hostWithEdges, 'Host must be retrievable by ID');
  assert.ok(Array.isArray(hostWithEdges.edges.outgoing), 'Host must have outgoing edges');
  const runsOnEdge = hostWithEdges.edges.outgoing.find(e => e.to_entity === 'app:cloudbees_jenkins' && e.edge_type === 'runs_on');
  assert.ok(runsOnEdge, 'Host must have a runs_on relationship to the application');
  console.log('✔ Test 5 Passed: Topology edge verified: host:newhost-01.corp -> runs_on -> app:cloudbees_jenkins');

  // Test 6: N-hop Graph Traversal
  const graph = await inventory.getEntityGraph('host:newhost-01.corp', 2);
  assert.ok(graph, 'Graph must be generated');
  assert.strictEqual(graph.rootId, 'host:newhost-01.corp');
  assert.strictEqual(graph.entities.length, 2);
  assert.strictEqual(graph.edges.length, 1);
  console.log('✔ Test 6 Passed: Graph traversal returned connected components.');

  // Test 7: Normalizer entity_id threading (T1.7)
  const { normalizeOtlpPayload } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');
  const normalized = normalizeOtlpPayload(syntheticPayload);
  assert.ok(normalized.length > 0, 'Normalizer must return rows');
  assert.strictEqual(normalized[0].component, 'cloudbees_jenkins', 'Component must be preserved (C3)');
  assert.strictEqual(normalized[0].entity_id, 'host:newhost-01.corp', 'Entity ID must be attached (T1.7)');
  console.log('✔ Test 7 Passed: Normalizer threaded entity_id while preserving component.');

  console.log('=== ALL INVENTORY OTLP AUTO-DISCOVERY TESTS PASSED ===\n');
}

if (require.main === module) {
  runInventoryDiscoveryTests().catch(err => {
    console.error('❌ Inventory discovery test failed:', err);
    process.exit(1);
  });
}

module.exports = { runInventoryDiscoveryTests };
