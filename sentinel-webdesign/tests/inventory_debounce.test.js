/**
 * Test: inventory cache writes are debounced (1,000 updates cause at most 2 file writes).
 */
const assert = require('assert');
const fs = require('fs');

// Debounce window longer than the loop, so the result does not depend on how fast
// the (unreachable) Postgres write-through fails on this machine.
process.env.INVENTORY_SAVE_DEBOUNCE_MS = process.env.INVENTORY_SAVE_DEBOUNCE_MS || '60000';

async function testInventoryDebounce() {
  console.log('=== RUNNING INVENTORY CACHE DEBOUNCE TEST ===');
  const store = require('../inventory/store');

  let writeCount = 0;
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (...args) {
    writeCount++;
    return originalWriteFileSync.apply(this, args);
  };

  try {
    for (let i = 0; i < 1000; i++) {
      await store.upsertEntity({
        entity_id: `host:test-node-${i}`,
        kind: 'host',
        name: `test-node-${i}`,
        environment: 'staging'
      });
    }

    assert.ok(writeCount <= 2, `1,000 upserts caused ${writeCount} writes, expected <= 2`);
    console.log(`✔ Passed: 1,000 upserts caused ${writeCount} file write(s) (<= 2).`);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
}

testInventoryDebounce()
  .then(() => {
    console.log('=== INVENTORY DEBOUNCE TEST PASSED ===');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Inventory debounce test failed:', err);
    process.exit(1);
  });
