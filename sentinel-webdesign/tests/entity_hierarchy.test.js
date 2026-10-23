/**
 * Test: inventory entity hierarchy and topology built from the manifests.
 */
const assert = require('assert');
const inventory = require('../inventory');
const yamlConfig = require('../backend/config/yaml_config');

async function runEntityHierarchyTests() {
  console.log('=== RUNNING ENTITY HIERARCHY & TOPOLOGY TESTS (T1.4) ===');

  inventory.store.clear();

  // Test 1: Sync declarative YAML topology
  const syncResult = await inventory.sources.yaml.syncYamlTopology();
  assert.ok(syncResult.entityCount > 0, 'Must discover entities from YAML');
  assert.ok(syncResult.edgeCount > 0, 'Must discover edges from YAML');
  console.log(`✔ Test 1 Passed: Ingested ${syncResult.entityCount} entities and ${syncResult.edgeCount} edges from YAML topology.`);

  // Test 2: OC -> Controller hierarchy
  const app = await inventory.getEntityById('app:cloudbees_jenkins');
  assert.ok(app, 'CloudBees Jenkins application entity must exist');
  assert.strictEqual(app.kind, 'app');
  console.log('✔ Test 2 Passed: Application entity resolved:', app.entity_id);

  const oc = await inventory.getEntityById('oc:oc-01');
  assert.ok(oc, 'OC-01 entity must exist');
  assert.strictEqual(oc.kind, 'oc');
  assert.strictEqual(oc.parent_id, 'app:cloudbees_jenkins');
  console.log('✔ Test 3 Passed: Operations Center OC-01 hierarchy verified:', oc.entity_id);

  const ctrlAps = await inventory.getEntityById('controller:oc-01:oc-01-aps');
  assert.ok(ctrlAps, 'Controller oc-01-aps must exist');
  assert.strictEqual(ctrlAps.kind, 'controller');
  assert.strictEqual(ctrlAps.parent_id, 'oc:oc-01');
  console.log('✔ Test 4 Passed: Controller oc-01-aps hierarchy verified:', ctrlAps.entity_id);

  // Test 3: Agent pools and expected counts
  const winPool = await inventory.getEntityById('agent_pool:cloudbees_jenkins:win-build');
  assert.ok(winPool, 'Windows build agent pool must exist');
  assert.strictEqual(winPool.labels.expected_count, 200, 'Expected Windows agent pool count must be 200');
  assert.strictEqual(winPool.labels.os, 'windows');
  console.log('✔ Test 5 Passed: Windows build agent pool expected_count=200 verified.');

  const linuxPool = await inventory.getEntityById('agent_pool:cloudbees_jenkins:linux-docker');
  assert.ok(linuxPool, 'Linux build agent pool must exist');
  assert.strictEqual(linuxPool.labels.expected_count, 50, 'Expected Linux agent pool count must be 50');
  console.log('✔ Test 6 Passed: Linux docker agent pool expected_count=50 verified.');

  const tcPool = await inventory.getEntityById('agent_pool:jetbrains_teamcity:tc-agents');
  assert.ok(tcPool, 'TeamCity agent pool must exist');
  assert.strictEqual(tcPool.labels.expected_count, 100, 'Expected TeamCity agent pool count must be 100');
  console.log('✔ Test 7 Passed: TeamCity agent pool expected_count=100 verified.');

  // Test 4: Discovered vs Expected Agent Counts
  const mockComputers = Array.from({ length: 195 }, (_, i) => ({
    name: `win-agent-${i + 1}`,
    displayName: `win-agent-${i + 1}`,
    os: 'windows',
    offline: i < 5 // 5 offline agents
  }));
  const jenkinsSync = await inventory.sources.jenkins.syncJenkinsInventory({ computers: mockComputers });
  assert.strictEqual(jenkinsSync.discoveredAgents, 195);
  const discoveredAgents = await inventory.getEntities({ kind: 'agent', app_id: 'cloudbees_jenkins', limit: 500 });
  const activeCount = discoveredAgents.entities.filter(a => a.status === 'Active').length;
  const offlineCount = discoveredAgents.entities.filter(a => a.status === 'Offline').length;
  assert.strictEqual(activeCount, 190);
  assert.strictEqual(offlineCount, 5);
  console.log(`✔ Test 8 Passed: Discovered fleet reconciliation: ${discoveredAgents.total} discovered vs ${winPool.labels.expected_count} expected.`);

  // Test 5: Alias resolution (T1.5)
  const resolvedFromAlias = yamlConfig.getApplication('jenkins_k8s');
  assert.ok(resolvedFromAlias, 'jenkins_k8s must resolve via alias');
  assert.strictEqual(resolvedFromAlias.id, 'cloudbees_jenkins', 'jenkins_k8s must resolve to primary cloudbees_jenkins manifest');

  const resolvedTcAlias = yamlConfig.getApplication('teamcity');
  assert.ok(resolvedTcAlias, 'teamcity must resolve via alias');
  assert.strictEqual(resolvedTcAlias.id, 'jetbrains_teamcity', 'teamcity must resolve to jetbrains_teamcity manifest');
  console.log('✔ Test 9 Passed: App alias resolution verified for retired component IDs (T1.5).');

  console.log('=== ALL ENTITY HIERARCHY & TOPOLOGY TESTS PASSED ===\n');
}

if (require.main === module) {
  runEntityHierarchyTests().catch(err => {
    console.error('❌ Entity hierarchy test failed:', err);
    process.exit(1);
  });
}

module.exports = { runEntityHierarchyTests };
