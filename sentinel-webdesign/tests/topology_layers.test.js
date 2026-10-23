/**
 * tests/topology_layers.test.js
 *
 * M3 Task 3.2 Acceptance Tests:
 * 1. syncYamlTopology builds VIP -> Product -> Hosts -> Shares -> Databases graph.
 * 2. Edges connect layers with expected types (routes_traffic_to, runs_on, mounts, reads_writes, depends_on).
 * 3. GET /api/v2/topology/:productId returns structured sub-graph with categorized layers.
 * 4. Unknown product returns 404.
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const inventory = require('../inventory');
const { syncYamlTopology } = require('../inventory/sources/yaml_source');
const topologyRoutes = require('../backend/routes/topologyRoutes');

async function runTests() {
  console.log('[TEST] Starting M3 Task 3.2 Topology Layers Tests...');

  // Reset in-memory inventory store
  inventory.store.clear();

  // Run topology synchronization from manifests
  console.log('[TEST] Case 1: Synchronizing topology from application manifests...');
  const { entityCount, edgeCount } = await syncYamlTopology();
  assert.ok(entityCount > 0, `Entities should be created, got ${entityCount}`);
  assert.ok(edgeCount > 0, `Edges should be created, got ${edgeCount}`);
  console.log(`✔ Case 1 Passed: Synchronized ${entityCount} entities and ${edgeCount} edges.`);

  // Inspect sample application: jfrog_artifactory
  console.log('[TEST] Case 2: Verifying multi-layer graph for jfrog_artifactory...');
  const artifactoryEntity = await inventory.getEntityById('app:jfrog_artifactory');
  assert.ok(artifactoryEntity, 'Product entity app:jfrog_artifactory must exist');
  assert.strictEqual(artifactoryEntity.kind, 'app', 'Entity kind must be app');

  // Verify VIP -> Product edge
  const graph = await inventory.getEntityGraph('app:jfrog_artifactory', 3);
  assert.ok(graph, 'Graph must exist for jfrog_artifactory');

  const entityKinds = new Set(graph.entities.map(e => e.kind));
  assert.ok(entityKinds.has('vip'), 'Graph must include vip entities');
  assert.ok(entityKinds.has('host'), 'Graph must include host entities');
  assert.ok(entityKinds.has('storage'), 'Graph must include storage/share entities');
  assert.ok(entityKinds.has('database'), 'Graph must include database entities');
  assert.ok(entityKinds.has('k8s_cluster'), 'Graph must include k8s_cluster entities');

  const edgeTypes = new Set(graph.edges.map(e => e.edge_type));
  assert.ok(edgeTypes.has('routes_traffic_to'), 'Must have routes_traffic_to edge (VIP -> App)');
  assert.ok(edgeTypes.has('runs_on'), 'Must have runs_on edge (App -> Host)');
  assert.ok(edgeTypes.has('mounts'), 'Must have mounts edge (Host/App -> Share)');
  assert.ok(edgeTypes.has('reads_writes'), 'Must have reads_writes edge (App -> Database)');
  assert.ok(edgeTypes.has('depends_on'), 'Must have depends_on edge (App -> Cluster)');
  console.log('✔ Case 2 Passed: Multi-layer graph and relationships verified.');

  // Test API endpoint GET /api/v2/topology/:productId
  console.log('[TEST] Case 3: Testing GET /api/v2/topology/:productId endpoint...');
  const app = express();
  app.use(express.json());
  app.use('/api/v2/topology', topologyRoutes);

  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  try {
    // 3a. Success case
    const res = await fetch(`http://127.0.0.1:${port}/api/v2/topology/jfrog_artifactory?environment=staging`);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json();

    assert.strictEqual(body.productId, 'jfrog_artifactory');
    assert.ok(body.layers, 'Response must contain layers object');
    assert.ok(Array.isArray(body.layers.vip) && body.layers.vip.length > 0, 'layers.vip must be populated');
    assert.ok(Array.isArray(body.layers.hosts) && body.layers.hosts.length > 0, 'layers.hosts must be populated');
    assert.ok(Array.isArray(body.layers.shares) && body.layers.shares.length > 0, 'layers.shares must be populated');
    assert.ok(Array.isArray(body.layers.databases) && body.layers.databases.length > 0, 'layers.databases must be populated');
    assert.ok(Array.isArray(body.layers.clusters) && body.layers.clusters.length > 0, 'layers.clusters must be populated');

    // 3b. 404 case for non-existent product
    const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/v2/topology/unknown_tool_xyz_999`);
    assert.strictEqual(notFoundRes.status, 404, 'Expected 404 for unknown product');
    console.log('✔ Case 3 Passed: /api/v2/topology endpoint served layers and handled 404 cleanly.');
  } finally {
    await new Promise(res => server.close(res));
  }

  console.log('All M3 Task 3.2 topology layer tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('Topology Layer Test Failure:', err);
  process.exit(1);
});
