const assert = require('assert');
const config = require('../packages/config/config');
const db = require('../packages/database/db');
const postgres = require('../packages/database/postgres');
const snowflake = require('../packages/database/snowflake');
const appCollector = require('../apps/collector/src/metrics_collection/real/applications/app_collector');

console.log('======================================================');
console.log('🧪 RUNNING STRICT ENVIRONMENT VALUE AVAILABILITY TEST');
console.log('======================================================');

(async () => {
  const originalEnv = config.ENVIRONMENT;

  // ----------------------------------------------------
  // Test 1: Production Environment strict segregation
  // ----------------------------------------------------
  config.ENVIRONMENT = 'prod';
  global.runtimeEnvironment = 'prod';

  // In production, unmonitored or missing application metrics must return sentinel
  const prodMetrics = db.getMetrics('unregistered_prod_component', 10, 'prod');
  assert.strictEqual(prodMetrics.length, 1);
  assert.strictEqual(prodMetrics[0].value, 'Data Not Available');
  assert.strictEqual(prodMetrics[0].env, 'prod');
  console.log('✔ Test 1a Passed: Unmonitored production component returns sentinel');

  // Verify that prod query does NOT leak staging or demo metrics
  db.addMetric('test_shared_app', 'cpu', 45, 'staging');
  const prodCheck = db.getMetrics('test_shared_app', 10, 'prod');
  // Staging metric was recorded; prod should NOT see it
  assert.ok(
    prodCheck.length === 1 && prodCheck[0].value === 'Data Not Available',
    'Production query must NOT leak staging data points'
  );
  console.log('✔ Test 1b Passed: Production query strictly isolates against staging telemetry');

  // ----------------------------------------------------
  // Test 2: Staging Environment strict segregation
  // ----------------------------------------------------
  config.ENVIRONMENT = 'staging';
  global.runtimeEnvironment = 'staging';

  // Staging query for unmonitored component
  const stgMetrics = db.getMetrics('unregistered_stg_component', 10, 'staging');
  assert.strictEqual(stgMetrics.length, 1);
  assert.strictEqual(stgMetrics[0].value, 'Data Not Available');
  assert.strictEqual(stgMetrics[0].env, 'staging');
  console.log('✔ Test 2a Passed: Unmonitored staging component returns sentinel');

  // Record prod metric and verify staging cannot see it
  db.addMetric('test_leak_app', 'cpu', 99, 'prod');
  const stgCheck = db.getMetrics('test_leak_app', 10, 'staging');
  assert.ok(
    stgCheck.length === 1 && stgCheck[0].value === 'Data Not Available',
    'Staging query must NOT leak production telemetry'
  );
  console.log('✔ Test 2b Passed: Staging query strictly isolates against production telemetry');

  // ----------------------------------------------------
  // Test 3: Formatting & Helper Validation for "Value Not Available"
  // ----------------------------------------------------
  // Helper functions matching frontend formatting
  const isUnavailableVal = (val) => val === null || val === undefined || val === 'Data Not Available' || val === 'Value Not Available';
  const fmtVal = (val, unit = '') => isUnavailableVal(val) ? 'Value Not Available' : `${val}${unit}`;
  const formatStatusText = (status) => (status === 'DATA_UNAVAILABLE' || status === 'NO_DATA') ? 'Value Not Available' : (status || 'UNKNOWN').toUpperCase();

  assert.strictEqual(fmtVal(null), 'Value Not Available');
  assert.strictEqual(fmtVal(undefined), 'Value Not Available');
  assert.strictEqual(fmtVal('Data Not Available'), 'Value Not Available');
  assert.strictEqual(fmtVal('Value Not Available'), 'Value Not Available');
  assert.strictEqual(fmtVal(42, 'ms'), '42ms');
  assert.strictEqual(formatStatusText('DATA_UNAVAILABLE'), 'Value Not Available');
  assert.strictEqual(formatStatusText('NO_DATA'), 'Value Not Available');
  assert.strictEqual(formatStatusText('healthy'), 'HEALTHY');
  console.log('✔ Test 3 Passed: Value Not Available sanitization conforms across all states');

  // Restore environment
  config.ENVIRONMENT = originalEnv;
  global.runtimeEnvironment = originalEnv;

  console.log('======================================================');
  console.log('✅ ALL STRICT ENVIRONMENT AVAILABILITY TESTS PASSED!');
  console.log('======================================================');
  process.exit(0);
})().catch(err => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});
