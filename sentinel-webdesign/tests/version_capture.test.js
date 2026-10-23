/**
 * tests/version_capture.test.js
 *
 * Tests product version capture, inventory label updating, version_change event emission,
 * and debouncing on identical versions.
 */

const assert = require('assert');
const http = require('http');
const inventory = require('@sentinel/inventory');
const eventStore = require('@sentinel/database/event_store');
const versionTracker = require('../metrics_collection/shared/version_tracker');
const artifactoryCollector = require('../metrics_collection/real/applications/artifactory_collector');
const config = require('@sentinel/config');

async function runTests() {
  console.log('[TEST] Starting product version capture tests...');
  if (inventory.store && typeof inventory.store.clear === 'function') {
    inventory.store.clear();
  }
  versionTracker.clear();

  // 1. Initial version capture (first discovery)
  console.log('[TEST] Case 1: Initial version discovery updates inventory label...');
  const initEvent = await versionTracker.updateProductVersion('test_app', '1.0.0', 'staging', 'product_api');
  assert.strictEqual(initEvent, null, 'Initial discovery should not emit upgrade event');

  let entity = await inventory.getEntityById('app:test_app');
  assert.ok(entity, 'Entity app:test_app should exist in inventory');
  assert.strictEqual(entity.labels?.version, '1.0.0', 'Entity label version should be 1.0.0');
  console.log('✔ Case 1 Passed: Initial version stored in inventory.');

  // 2. Version upgrade emission
  console.log('[TEST] Case 2: Product upgrade from 1.0.0 to 1.1.0 emits version_change event...');
  const upgradeEvent = await versionTracker.updateProductVersion('test_app', '1.1.0', 'staging', 'product_api');
  assert.ok(upgradeEvent, 'Upgrade should emit event');
  assert.strictEqual(upgradeEvent.kind, 'version_change');
  assert.strictEqual(upgradeEvent.details.old_version, '1.0.0');
  assert.strictEqual(upgradeEvent.details.new_version, '1.1.0');
  assert.strictEqual(upgradeEvent.entity_id, 'app:test_app');

  // Verify event persists in eventStore
  const events = await eventStore.getEvents({ kind: 'version_change', environment: 'staging' });
  const matched = events.find(e => e.entity_id === 'app:test_app' && e.payload?.new_version === '1.1.0');
  assert.ok(matched, 'Event should be retrievable from eventStore');

  // Verify inventory label is updated to 1.1.0
  entity = await inventory.getEntityById('app:test_app');
  assert.strictEqual(entity.labels?.version, '1.1.0', 'Entity label version should now be 1.1.0');
  console.log('✔ Case 2 Passed: version_change event emitted and inventory updated.');

  // 3. Debounce on subsequent identical polls
  console.log('[TEST] Case 3: Polling identical version 1.1.0 is debounced (zero duplicate events)...');
  const countBefore = (await eventStore.getEvents({ kind: 'version_change', environment: 'staging' })).length;
  const noopEvent = await versionTracker.updateProductVersion('test_app', '1.1.0', 'staging', 'product_api');
  assert.strictEqual(noopEvent, null, 'Identical version should return null');

  const countAfter = (await eventStore.getEvents({ kind: 'version_change', environment: 'staging' })).length;
  assert.strictEqual(countAfter, countBefore, 'Event count should not increase on debounced poll');
  console.log('✔ Case 3 Passed: Debounced poll emitted zero duplicate events.');

  // 4. Live collector integration with fake product API
  console.log('[TEST] Case 4: Real collector parses version from API endpoint...');
  let fakeApiVersion = '7.29.1';
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/storageinfo') {
      res.end(JSON.stringify({ storageSummary: { binariesSummary: { usedSpace: 1024 } } }));
    } else if (req.url === '/system/version') {
      res.end(JSON.stringify({ version: fakeApiVersion }));
    } else {
      res.end(JSON.stringify({ status: 'OK' }));
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const originalEnvStg = process.env.STG_ARTIFACTORY_API;
  const originalEnvDirect = process.env.ARTIFACTORY_API;

  try {
    process.env.STG_ARTIFACTORY_API = `http://127.0.0.1:${port}`;
    process.env.ARTIFACTORY_API = `http://127.0.0.1:${port}`;
    global.runtimeEnvironment = 'staging';

    // Collector runs with 7.29.1
    await artifactoryCollector.collect({});
    let artEntity = await inventory.getEntityById('app:artifactory');
    assert.strictEqual(artEntity?.labels?.version, '7.29.1', 'Artifactory initial version should be 7.29.1');

    // Upgrade API to 7.30.0
    fakeApiVersion = '7.30.0';
    await artifactoryCollector.collect({});
    artEntity = await inventory.getEntityById('app:artifactory');
    assert.strictEqual(artEntity?.labels?.version, '7.30.0', 'Artifactory upgraded version should be 7.30.0');

    const artEvents = await eventStore.getEvents({ kind: 'version_change', environment: 'staging' });
    const artUpgrade = artEvents.find(e => e.entity_id === 'app:artifactory' && e.payload?.new_version === '7.30.0');
    assert.ok(artUpgrade, 'Should find Artifactory 7.30.0 upgrade event');
    assert.strictEqual(artUpgrade.payload.old_version, '7.29.1');
    console.log('✔ Case 4 Passed: Collector integration cleanly detected and recorded version upgrade.');
  } finally {
    if (originalEnvStg !== undefined) process.env.STG_ARTIFACTORY_API = originalEnvStg;
    else delete process.env.STG_ARTIFACTORY_API;
    if (originalEnvDirect !== undefined) process.env.ARTIFACTORY_API = originalEnvDirect;
    else delete process.env.ARTIFACTORY_API;
    server.close();
  }

  console.log('All product version capture tests passed successfully!\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Version capture test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
