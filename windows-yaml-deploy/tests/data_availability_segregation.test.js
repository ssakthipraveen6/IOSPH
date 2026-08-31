const assert = require('assert');
const config = require('../config/config');
const db = require('../database/db');
const postgres = require('../database/postgres');
const snowflake = require('../database/snowflake');
const appCollector = require('../metrics_collection/real/applications/app_collector');

console.log('======================================================');
console.log('🧪 RUNNING ENVIRONMENT SEGREGATION & DATA AVAILABILITY SUITE');
console.log('======================================================');

(async () => {
  const originalEnv = config.ENVIRONMENT;

  // ----------------------------------------------------
  // Test 1: Prod Environment Segregation & "Data Not Available"
  // ----------------------------------------------------
  config.ENVIRONMENT = 'prod';
  
  // 1a: Missing or offline application metrics flag DATA_UNAVAILABLE in prod
  const prodAppMetrics = await appCollector.collectAppMetrics({}, db, () => {});
  const unavailApps = Object.keys(prodAppMetrics).filter(k => prodAppMetrics[k].status === 'DATA_UNAVAILABLE');
  assert.ok(unavailApps.length > 0, 'Offline apps in prod must flag DATA_UNAVAILABLE');
  assert.strictEqual(prodAppMetrics[unavailApps[0]].metrics.error, 'Data Not Available');
  console.log('✔ Test 1a Passed: Prod collector marks unreachable endpoints as DATA_UNAVAILABLE');

  // 1b: Database getMetrics returns Data Not Available sentinel when no telemetry
  const prodCompMetrics = db.getMetrics('nonexistent_component', 10, 'prod');
  assert.strictEqual(prodCompMetrics.length, 1);
  assert.strictEqual(prodCompMetrics[0].value, 'Data Not Available');
  assert.strictEqual(prodCompMetrics[0].env, 'prod');
  console.log('✔ Test 1b Passed: Prod getMetrics returns sentinel "Data Not Available"');

  // 1c: Postgres historical queries in prod return empty array if no records
  const prodHist = await postgres.fetchHistoricalMetricsFromPostgres('database', 'cpu_usage', 24, 'prod');
  assert.strictEqual(Array.isArray(prodHist), true);
  assert.strictEqual(prodHist.length, 0);
  console.log('✔ Test 1c Passed: Prod historical queries return empty array when unpopulated');

  // 1d: Snowflake analytics in prod return all 0s so UI shows Data Not Available
  const prodSnowflake = snowflake.fetchLogAnalyticsFromSnowflake('prod');
  assert.ok(prodSnowflake.every(l => l.info === 0 && l.warn === 0 && l.error === 0));
  console.log('✔ Test 1d Passed: Prod Snowflake analytics return zeroed counts');

  // ----------------------------------------------------
  // Test 2: Staging Environment Segregation & "Data Not Available"
  // ----------------------------------------------------
  config.ENVIRONMENT = 'staging';

  // 2a: Staging getMetrics returns Data Not Available sentinel when component has no metrics
  const stgCompMetrics = db.getMetrics('unmonitored_staging_app', 10, 'staging');
  assert.strictEqual(stgCompMetrics.length, 1);
  assert.strictEqual(stgCompMetrics[0].value, 'Data Not Available');
  assert.strictEqual(stgCompMetrics[0].env, 'staging');
  console.log('✔ Test 2a Passed: Staging getMetrics returns sentinel "Data Not Available" when no telemetry exists');

  // 2b: Staging alerts and recovery isolation
  const stgAlerts = db.getAlerts('staging');
  assert.ok(stgAlerts.every(a => a.env === 'staging'), 'Staging alerts must strictly be tagged staging');
  const stgRecovery = db.getRecoveryLogs('staging');
  assert.ok(stgRecovery.every(r => r.env === 'staging'), 'Staging recovery logs must strictly be tagged staging');
  console.log('✔ Test 2b Passed: Staging alerts and recovery logs maintain strict isolation');

  // ----------------------------------------------------
  // Test 3: Demo Environment Segregation
  // ----------------------------------------------------
  config.ENVIRONMENT = 'demo';
  const demoMetrics = db.getMetrics('database', 10, 'demo');
  assert.ok(demoMetrics.length > 0, 'Demo environment provides simulated data points');
  const demoAlerts = db.getAlerts('demo');
  assert.ok(demoAlerts.length > 0, 'Demo environment provides simulated alerts');
  const demoHist = await postgres.fetchHistoricalMetricsFromPostgres('database', 'cpu_usage', 24, 'demo');
  assert.ok(demoHist.length > 0, 'Demo environment provides synthetic historical timeseries');
  console.log('✔ Test 3 Passed: Demo mode provides simulated data points isolated from prod/staging');

  // ----------------------------------------------------
  // Test 4: Concurrent Multi-Environment Collection (Switching to PROD continues Staging collection)
  // ----------------------------------------------------
  config.ENVIRONMENT = 'prod';
  global.runtimeEnvironment = 'prod';

  // Explicitly collect for staging and prod in background
  const stgMetrics = await appCollector.collectAppMetrics({}, db, () => {}, 'staging');
  const prodMetrics = await appCollector.collectAppMetrics({}, db, () => {}, 'prod');

  // Verify staging data was collected and saved under staging tag
  const latestStaging = db.getMetrics('bitbucket', 5, 'staging');
  assert.ok(latestStaging.length > 0, 'Staging collection must continue when runtimeEnvironment is prod');
  assert.ok(latestStaging.every(m => m.env === 'staging'), 'Staging metrics must strictly be tagged staging');

  // Verify prod query only returns prod metrics
  const latestProd = db.getMetrics('bitbucket', 5, 'prod');
  assert.ok(latestProd.length > 0, 'Prod collection must record prod telemetry');
  assert.ok(latestProd.every(m => m.env === 'prod'), 'Prod metrics must strictly be tagged prod');

  console.log('✔ Test 4 Passed: Dual background collection maintains continuous updates for both Prod and Staging');

  // Restore environment
  config.ENVIRONMENT = originalEnv;
  global.runtimeEnvironment = originalEnv;
  console.log('\n======================================================');
  console.log('📊 ENVIRONMENT SEGREGATION & DATA AVAILABILITY TESTS PASSED');
  console.log('======================================================\n');
})().catch(err => {
  console.error('❌ Environment segregation test failed:', err);
  process.exit(1);
});
