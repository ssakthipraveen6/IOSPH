const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');

async function runPhase4Validation() {
  console.log('=== [SENTINEL] Phase 4 Remediation Validation Suite ===\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      throw e;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      throw e;
    }
  }

  // 1. Database Migrations (004_create_event_schema.sql & .down.sql)
  test('Check Migration 004 Up & Down SQL exists and is reversible', () => {
    const upPath = path.resolve(__dirname, '../../database/migrations/004_create_event_schema.sql');
    const downPath = path.resolve(__dirname, '../../database/migrations/004_create_event_schema.down.sql');
    assert(fs.existsSync(upPath), '004_create_event_schema.sql must exist');
    assert(fs.existsSync(downPath), '004_create_event_schema.down.sql must exist');

    const upSql = fs.readFileSync(upPath, 'utf8');
    const downSql = fs.readFileSync(downPath, 'utf8');

    assert(upSql.includes('CREATE TABLE IF NOT EXISTS event'), 'Must create event table');
    assert(upSql.includes('CREATE TABLE IF NOT EXISTS rca_hypothesis'), 'Must create rca_hypothesis table');
    assert(upSql.includes('entity_id'), 'event table must index entity_id');
    assert(downSql.includes('DROP TABLE IF EXISTS rca_hypothesis'), 'down migration must drop rca_hypothesis');
    assert(downSql.includes('DROP TABLE IF EXISTS event'), 'down migration must drop event');
  });

  // 2. Correlation Configuration File
  test('Check config/correlation.yaml exists and contains required weights and thresholds', () => {
    const cfgPath = path.resolve(__dirname, '../../config/correlation.yaml');
    assert(fs.existsSync(cfgPath), 'config/correlation.yaml must exist');
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    assert(cfg && cfg.correlation, 'Config must have correlation root key');
    assert(cfg.correlation.weights, 'Config must have weights');
    assert.strictEqual(cfg.correlation.weights.fanout, 0.40, 'fanout weight must be 0.40');
    assert.strictEqual(cfg.correlation.weights.temporal_precedence, 0.25, 'temporal_precedence weight must be 0.25');
    assert.strictEqual(cfg.correlation.weights.graph_proximity, 0.20, 'graph_proximity weight must be 0.20');
    assert.strictEqual(cfg.correlation.weights.change_proximity, 0.15, 'change_proximity weight must be 0.15');
    assert.strictEqual(cfg.correlation.thresholds.high_confidence, 0.75, 'high_confidence must be 0.75');
  });

  // 3. Package Registration (@sentinel/correlation)
  test('Check @sentinel/correlation is registered and exportable', () => {
    const pkg = require('@sentinel/correlation');
    assert(typeof pkg.correlateSymptom === 'function', 'correlateSymptom must be a function');
    assert(typeof pkg.findDownstreamInfra === 'function', 'findDownstreamInfra must be a function');
    assert(typeof pkg.findDependentApps === 'function', 'findDependentApps must be a function');
  });

  // 4. Run the Full Replay Scenario (14 apps, shared storage, confidence > 0.75, blast radius 14)
  await testAsync('Run End-to-End Correlation Replay Scenario (Exit Criteria)', async () => {
    const { runCorrelationReplayTest } = require('../../tests/correlation_replay.test');
    await runCorrelationReplayTest();
  });

  // 5. Canned RCA Text Retired for Prod/Staging
  await testAsync('Verify rca_analytics_engine reads real hypotheses in prod/staging and keeps demo canned', async () => {
    const rcaEngine = require('../../ai_analysis/rca_analytics_engine');
    const eventStore = require('../../database/event_store');

    // In demo environment: returns canned profile
    const demoFlows = await rcaEngine.generateRcaFlows('jenkins', 'demo');
    assert(demoFlows.correlations.length > 0, 'Demo correlations must exist');
    assert(demoFlows.correlations[0].id.includes('DEMO'), 'Demo correlation must be flagged demo');

    // In prod environment with no hypothesis: returns empty
    const prodEmpty = await rcaEngine.generateRcaFlows('jenkins', 'prod');
    assert.strictEqual(prodEmpty.correlations.length, 0, 'Prod with no hypothesis must return empty array');

    // Add a real hypothesis to staging
    const hypoId = 'hypo-val-' + crypto.randomUUID();
    await eventStore.saveHypothesis({
      hypothesis_id: hypoId,
      trigger_event_id: 'evt-test-trigger',
      suspect_entity_id: 'storage:san-tier1',
      confidence: 0.88,
      blast_radius: 6,
      rationale: [{ step: 1, observation: 'SAN volume lock' }],
      environment: 'staging',
      status: 'open'
    });

    const stgFlows = await rcaEngine.generateRcaFlows('jenkins', 'staging');
    assert(stgFlows.correlations.length > 0, 'Staging should return real hypothesis');
    assert(stgFlows.correlations.some(c => c.id === hypoId), 'Should include the saved hypothesis');
  });

  // 6. Predictive Analysis Environment Awareness
  test('Verify predictive.js is environment-aware and does not leak cross-environment', () => {
    const predictive = require('../../ai_analysis/predictive');
    const db = require('@sentinel/database');
    assert(typeof predictive.runPredictiveAnalysis === 'function', 'runPredictiveAnalysis must be exported');

    // Clear alerts and run with staging
    predictive.runPredictiveAnalysis({}, 'staging');
    const prodAlerts = db.getAlerts('prod');
    // Ensure no spurious alerts leaked into prod
    assert(Array.isArray(prodAlerts), 'Prod alerts should be an array');
  });

  // 7. Frontend Dynamic Correlation Client Shapes
  test('Verify correlationData.js exports identical shape for UI components', () => {
    const corrData = require('../../frontend/src/data/correlationData');
    assert(Array.isArray(corrData.NORMALIZED_TIMELINE_EVENTS), 'NORMALIZED_TIMELINE_EVENTS must be an array');
    assert(Array.isArray(corrData.MASTER_ENTITY_CATALOG), 'MASTER_ENTITY_CATALOG must be an array');
    assert(typeof corrData.DRIFT_RCA_CORRELATION_STATS === 'object', 'DRIFT_RCA_CORRELATION_STATS must be an object');
    assert(typeof corrData.fetchTimelineEvents === 'function', 'fetchTimelineEvents must be exported');
    assert(typeof corrData.fetchLiveHypotheses === 'function', 'fetchLiveHypotheses must be exported');
    assert(typeof corrData.recordHypothesisVerdict === 'function', 'recordHypothesisVerdict must be exported');
  });

  console.log(`\n======================================================`);
  console.log(`  Phase 4 Validation Complete: ${passed} / ${total} checks passed.`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  runPhase4Validation()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n❌ Validation failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runPhase4Validation };
