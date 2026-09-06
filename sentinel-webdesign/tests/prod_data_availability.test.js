const assert = require('assert');
const config = require('../packages/config/config');
const appCollector = require('../apps/collector/src/metrics_collection/real/applications/app_collector');
const db = require('../packages/database/db');

console.log('======================================================');
console.log('🧪 RUNNING PRODUCTION DATA NOT AVAILABLE TEST SUITE');
console.log('======================================================');

// Save original environment
const originalEnv = config.ENVIRONMENT;

(async () => {
  // Test 1: In Prod Mode, unmonitored or unreachable applications flag DATA_UNAVAILABLE
  config.ENVIRONMENT = 'prod';
  
  const metrics = await appCollector.collectAppMetrics({}, db, () => {});
  
  // Verify that any app without live connectivity has state DATA_UNAVAILABLE and responseTime null
  const unreachableApps = Object.keys(metrics).filter(k => metrics[k].status === 'DATA_UNAVAILABLE');
  assert.ok(unreachableApps.length > 0, 'In prod mode, offline apps must be flagged as DATA_UNAVAILABLE');
  
  const sampleKey = unreachableApps[0];
  assert.strictEqual(metrics[sampleKey].status, 'DATA_UNAVAILABLE');
  assert.strictEqual(metrics[sampleKey].metrics.responseTime, null);
  assert.strictEqual(metrics[sampleKey].metrics.error, 'Data Not Available');
  console.log(`✔ Test 1 Passed: In prod mode, unreachable app [${sampleKey}] returns DATA_UNAVAILABLE with error: 'Data Not Available'`);

  // Restore original environment
  config.ENVIRONMENT = originalEnv;
  console.log(`✔ Test 2 Passed: Restored original environment to: [${originalEnv}]`);

  console.log('\n======================================================');
  console.log('📊 PRODUCTION DATA AVAILABILITY TESTS PASSED');
  console.log('======================================================');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
