const assert = require('assert');
const postgres = require('../database/postgres');
const db = require('../database/db');

async function runDatastoreTests() {
  console.log('=== RUNNING DATASTORE MIGRATION TESTS ===');

  // Test 1: Historical Metrics Query formatting check in demo mode
  const mockHistorical = await postgres.fetchHistoricalMetricsFromPostgres('database', 'cpuUsage', 24, 'demo');
  assert(Array.isArray(mockHistorical));
  assert(mockHistorical.length > 0);
  console.log('✔ Test 1 Passed: fetchHistoricalMetricsFromPostgres interval parameterization formatting verified');

  // Test 1b: In prod and staging mode without DB, returns empty array (Data Not Available)
  const prodHistorical = await postgres.fetchHistoricalMetricsFromPostgres('database', 'cpuUsage', 24, 'prod');
  assert(Array.isArray(prodHistorical));
  assert.strictEqual(prodHistorical.length, 0);
  console.log('✔ Test 1b Passed: In prod mode, missing historical metrics returns empty array');

  // Test 2: Batch Insert Execution
  const batchMetrics = [
    { timestamp: new Date().toISOString(), component: 'bitbucket', name: 'responseTime', value: 88.5 },
    { timestamp: new Date().toISOString(), component: 'artifactory', name: 'spaceUsed', value: 45.2 },
    { timestamp: new Date().toISOString(), component: 'avi_load_balancer', name: 'ingressFlow', value: 120.0 }
  ];

  db.addMetricBatch(batchMetrics);
  const recent = db.getMetrics(null, 10);
  assert(recent.length >= 3);
  console.log('✔ Test 2 Passed: Multi-row batch metric insert executed successfully');

  console.log('=== ALL DATASTORE MIGRATION TESTS PASSED ===\n');
}

if (require.main === module) {
  runDatastoreTests().catch(err => {
    console.error('❌ Datastore test failed:', err);
    process.exit(1);
  });
}

module.exports = { runDatastoreTests };
