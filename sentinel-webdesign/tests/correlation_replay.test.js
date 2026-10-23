/**
 * Test: replays a shared-storage failure and checks the correlation engine finds the dependent
 * applications.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const inventory = require('@sentinel/inventory');
const eventStore = require('../database/event_store');
const correlation = require('@sentinel/correlation');

async function runCorrelationReplayTest() {
  console.log('[TEST] Starting Phase 4 Correlation Engine Replay Scenario...');

  const startTime = Date.now();
  const testEnv = 'staging';

  // 1. Setup Topology: Shared storage entity and 14 dependent applications
  const storageEntityId = 'storage:nas-pool-01';
  await inventory.upsertEntity({
    entity_id: storageEntityId,
    name: 'NAS Enterprise Build Share Volume 01',
    kind: 'storage',
    tier: 'tier-1',
    environment: testEnv,
    metadata: { filesystem: 'nfs4', capacity_tb: 50 }
  });

  const appIds = [
    'jenkins', 'bitbucket', 'artifactory', 'argocd', 'teamcity',
    'fortify', 'nexusiq', 'sonarqube', 'github', 'otkr',
    'performance_center', 'argoworkflows', 'bitbucket_external', 'mcp'
  ];

  assert.strictEqual(appIds.length, 14, 'Scenario requires exactly 14 applications');

  for (const app of appIds) {
    const appEntityId = `app:${app}`;
    await inventory.upsertEntity({
      entity_id: appEntityId,
      name: `Application ${app.toUpperCase()}`,
      kind: 'application',
      tier: 'tier-1',
      environment: testEnv,
      metadata: { appKey: app }
    });

    await inventory.upsertEdge({
      from_entity: appEntityId,
      to_entity: storageEntityId,
      edge_type: 'mounts',
      environment: testEnv,
      metadata: { mountPath: '/data/shared' }
    });
  }

  // Verify dependent apps graph fan-out discovery
  const dependentApps = await correlation.findDependentApps(storageEntityId);
  console.log(`[TEST] Discovered ${dependentApps.length} dependent applications on ${storageEntityId}`);
  assert.strictEqual(dependentApps.length, 14, 'Expected all 14 apps to be discovered via graph fan-out');

  // 2. Inject Root Cause Infrastructure Anomaly Event
  const rootEventTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rootStorageEvent = await eventStore.addEvent({
    event_id: 'evt-storage-' + crypto.randomUUID(),
    ts: rootEventTs,
    entity_id: storageEntityId,
    kind: 'storage_event',
    severity: 'critical',
    title: 'NAS Storage Pool Degradation & IOPS Lock',
    summary: 'NFS latency spiked to 2400ms. Storage pool IOPS capacity exhausted on controller A.',
    payload: { iops: 12500, queueDepth: 84 },
    environment: testEnv,
    source: 'storage_telemetry'
  });

  assert(rootStorageEvent, 'Root storage event should be added');
  console.log(`[TEST] Injected root infrastructure event: ${rootStorageEvent.event_id} on ${storageEntityId}`);

  // 3. Inject Concurrent Symptoms across all 14 Dependent Applications
  const symptomEvents = [];
  for (let i = 0; i < appIds.length; i++) {
    const appEntityId = `app:${appIds[i]}`;
    const symptomTs = new Date(Date.now() - (8 * 60 * 1000) + (i * 10 * 1000)).toISOString();
    const evt = await eventStore.addEvent({
      event_id: `evt-symptom-${appIds[i]}-` + crypto.randomUUID(),
      ts: symptomTs,
      entity_id: appEntityId,
      kind: 'metric_anomaly',
      severity: 'critical',
      title: `${appIds[i].toUpperCase()} Disk I/O Wait & Pipeline Timeout`,
      summary: `I/O wait exceeded 65% with blocking locks on /data/shared mount.`,
      payload: { app: appIds[i], iowait: 68.2 },
      environment: testEnv,
      source: 'app_metrics'
    });
    symptomEvents.push(evt);
  }

  assert.strictEqual(symptomEvents.length, 14, '14 symptom events created');

  // 4. Trigger Correlator on first symptom (e.g. Jenkins build failure)
  const triggerEvent = symptomEvents[0];
  console.log(`[TEST] Triggering correlation engine for trigger event: ${triggerEvent.title}...`);

  const hypothesis = await correlation.correlateSymptom(triggerEvent);

  const durationMs = Date.now() - startTime;
  console.log(`[TEST] Correlation completed in ${durationMs}ms`);

  // Assertions as specified in Section 12 Phase 4 Exit Criteria:
  assert(hypothesis, 'Hypothesis must be produced');
  console.log(`[TEST] Hypothesis Generated: ID=${hypothesis.hypothesis_id}`);
  console.log(`[TEST] Suspect Entity: ${hypothesis.suspect_entity_id}`);
  console.log(`[TEST] Confidence: ${hypothesis.confidence}`);
  console.log(`[TEST] Blast Radius: ${hypothesis.blast_radius}`);

  assert.strictEqual(
    hypothesis.suspect_entity_id,
    storageEntityId,
    `Root cause must identify ${storageEntityId}`
  );

  assert(
    hypothesis.confidence > 0.75,
    `Confidence must be > 0.75 (high_confidence threshold). Actual: ${hypothesis.confidence}`
  );

  assert.strictEqual(
    hypothesis.blast_radius,
    14,
    `Blast radius must be exactly 14 affected apps. Actual: ${hypothesis.blast_radius}`
  );

  assert(
    durationMs < 60000,
    `Correlation analysis must complete within 60 seconds. Actual: ${durationMs}ms`
  );

  // Evidence chain verification:
  assert(Array.isArray(hypothesis.rationale), 'Rationale must be an evidence array');
  assert(hypothesis.rationale.length >= 2, 'Rationale must contain multiple evidence steps');

  const citesRoot = hypothesis.rationale.some(r => r.event_id === rootStorageEvent.event_id);
  assert(citesRoot, 'Rationale must cite root infrastructure event ID');

  const citesTrigger = hypothesis.rationale.some(r => r.event_id === triggerEvent.event_id);
  assert(citesTrigger, 'Rationale must cite symptom trigger event ID');

  // 5. Operator Feedback Loop Verification (T4.4)
  console.log('[TEST] Testing Operator Feedback Loop (Confirmed Verdict)...');
  const confirmed = await eventStore.recordVerdict(
    hypothesis.hypothesis_id,
    'confirmed',
    'sre-lead@sentinel.corp',
    'Confirmed storage controller failover caused NFS queue stall'
  );

  assert(confirmed, 'Verdict recording should succeed');
  assert.strictEqual(confirmed.status, 'confirmed', 'Hypothesis status must be confirmed');
  assert(Array.isArray(confirmed.verdicts), 'Verdicts list must exist');
  assert.strictEqual(confirmed.verdicts.length, 1, 'One verdict recorded');
  assert.strictEqual(confirmed.verdicts[0].verdict, 'confirmed', 'Verdict should be confirmed');
  assert.strictEqual(confirmed.verdicts[0].operator, 'sre-lead@sentinel.corp');

  // 6. Milestone M3 Task 3.3 Layer Diagnosis Rules Fixture Replays
  console.log('[TEST] Testing M3 Task 3.3 Layer Diagnosis Rules with Synthetic Fixtures...');
  const fs = require('fs');
  const fixturesDir = path.resolve(__dirname, 'fixtures');

  // Rule (a): network/AVI
  const fixtureA = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rule_a_network_avi.json'), 'utf8'));
  const diagA = correlation.diagnoseLayer(fixtureA);
  assert.ok(diagA.length > 0, 'Rule A must produce hypothesis');
  assert.strictEqual(diagA[0].layer, fixtureA.expectedLayer, `Expected layer ${fixtureA.expectedLayer}, got ${diagA[0].layer}`);
  assert.strictEqual(diagA[0].rule_id, fixtureA.expectedRuleId);
  console.log(`✔ Rule (a) Replay: Diagnosed layer '${diagA[0].layer}' with confidence ${diagA[0].confidence}`);

  // Rule (b): AVI/path (Enabled in M4.5)
  const fixtureB = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rule_b_avi_path.json'), 'utf8'));
  const diagB = correlation.diagnoseLayer(fixtureB);
  assert.ok(diagB.length > 0, 'Rule B must produce hypothesis');
  assert.strictEqual(diagB[0].layer, fixtureB.expectedLayer, `Expected layer ${fixtureB.expectedLayer}, got ${diagB[0].layer}`);
  assert.strictEqual(diagB[0].rule_id, fixtureB.expectedRuleId);
  console.log(`✔ Rule (b) Replay: Diagnosed layer '${diagB[0].layer}' with confidence ${diagB[0].confidence}`);

  // Rule (c): storage
  const fixtureC = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rule_c_storage.json'), 'utf8'));
  const diagC = correlation.diagnoseLayer(fixtureC);
  assert.ok(diagC.length > 0, 'Rule C must produce hypothesis');
  assert.strictEqual(diagC[0].layer, fixtureC.expectedLayer, `Expected layer ${fixtureC.expectedLayer}, got ${diagC[0].layer}`);
  assert.strictEqual(diagC[0].rule_id, fixtureC.expectedRuleId);
  console.log(`✔ Rule (c) Replay: Diagnosed layer '${diagC[0].layer}' with confidence ${diagC[0].confidence}`);

  // Rule (d): product
  const fixtureD = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rule_d_product.json'), 'utf8'));
  const diagD = correlation.diagnoseLayer(fixtureD);
  assert.ok(diagD.length > 0, 'Rule D must produce hypothesis');
  assert.strictEqual(diagD[0].layer, fixtureD.expectedLayer, `Expected layer ${fixtureD.expectedLayer}, got ${diagD[0].layer}`);
  assert.strictEqual(diagD[0].rule_id, fixtureD.expectedRuleId);
  console.log(`✔ Rule (d) Replay: Diagnosed layer '${diagD[0].layer}' with confidence ${diagD[0].confidence}`);

  // Rule (e): change
  const fixtureE = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rule_e_change.json'), 'utf8'));
  const diagE = correlation.diagnoseLayer(fixtureE);
  assert.ok(diagE.length > 0, 'Rule E must produce hypothesis');
  assert.strictEqual(diagE[0].layer, fixtureE.expectedLayer, `Expected layer ${fixtureE.expectedLayer}, got ${diagE[0].layer}`);
  assert.strictEqual(diagE[0].rule_id, fixtureE.expectedRuleId);
  console.log(`✔ Rule (e) Replay: Diagnosed layer '${diagE[0].layer}' with confidence ${diagE[0].confidence}`);

  // M5 Task 5.4: Problem Grouping Replay Test (5 alerts from one storage incident make 1 problem)
  console.log('\n[TEST] Testing M5 Task 5.4: Problem grouping from shared storage incident...');
  const storageAlerts = [
    { id: 'alt-1', component: 'jenkins', entity_id: 'app:jenkins', message: 'JENKINS Disk I/O Wait on /data/shared', severity: 'Critical', timestamp: new Date().toISOString() },
    { id: 'alt-2', component: 'bitbucket', entity_id: 'app:bitbucket', message: 'BITBUCKET Disk I/O Wait on /data/shared', severity: 'Critical', timestamp: new Date().toISOString() },
    { id: 'alt-3', component: 'artifactory', entity_id: 'app:artifactory', message: 'ARTIFACTORY Disk I/O Wait on /data/shared', severity: 'Critical', timestamp: new Date().toISOString() },
    { id: 'alt-4', component: 'argocd', entity_id: 'app:argocd', message: 'ARGOCD Disk I/O Wait on /data/shared', severity: 'Critical', timestamp: new Date().toISOString() },
    { id: 'alt-5', component: 'teamcity', entity_id: 'app:teamcity', message: 'TEAMCITY Disk I/O Wait on /data/shared', severity: 'Critical', timestamp: new Date().toISOString() }
  ];

  // [F3] The storage layer must come from diagnoseLayer evidence (storage-heavy journey
  // steps failing on two products), not from keywords in the alert text.
  const storageJourneyEvidence = [
    { id: 'artifactory_pipeline', productId: 'artifactory', steps: [{ id: 'download_canary', layer: 'storage', status: 'FAILED', duration_ms: 3500 }] },
    { id: 'bitbucket_clone', productId: 'bitbucket', steps: [{ id: 'clone_canary', layer: 'storage', status: 'FAILED', duration_ms: 4200 }] }
  ];
  const groupedProblems = await correlation.groupAlertsIntoProblems(storageAlerts, { environment: testEnv, journeys: storageJourneyEvidence });
  assert.strictEqual(groupedProblems.length, 1, '5 storage incident alerts must fold into exactly 1 problem');
  const prob = groupedProblems[0];
  assert.strictEqual(prob.alert_count, 5, 'Problem must contain all 5 alerts');
  assert.strictEqual(prob.top_layer, 'storage', `Top cause must be storage, got ${prob.top_layer}`);
  assert.strictEqual(prob.suspect_entity, storageEntityId, `Suspect entity must be ${storageEntityId}`);
  assert.ok(storageAlerts.every(a => a.problem_id === prob.id), 'All alerts must be tagged with the problem ID');
  console.log(`✔ Problem Grouping: 5 alerts folded into 1 problem (${prob.id}) with top cause '${prob.top_layer}' and suspect '${prob.suspect_entity}'.`);

  // Same alerts without any stored evidence: still grouped by topology, but no layer is invented.
  const noEvidenceAlerts = storageAlerts.map(a => ({ ...a, id: a.id + '-ne', problem_id: undefined }));
  const noEvidence = await correlation.groupAlertsIntoProblems(noEvidenceAlerts, { environment: testEnv });
  assert.strictEqual(noEvidence.length, 1, 'Topology grouping must not depend on evidence');
  assert.strictEqual(noEvidence[0].top_layer, 'unknown', 'Without evidence the top layer must be unknown');
  assert.strictEqual(noEvidence[0].confidence, null, 'Without evidence confidence must be null');

  // Two unrelated alerts (no shared topology) make two problems, each with layer unknown.
  const unrelated = [
    { id: 'u-1', component: 'unrelated-a', entity_id: 'app:unrelated-a', message: 'latency high', severity: 'Warning', timestamp: new Date().toISOString() },
    { id: 'u-2', component: 'unrelated-b', entity_id: 'app:unrelated-b', message: 'latency high', severity: 'Warning', timestamp: new Date().toISOString() }
  ];
  const unrelatedProblems = await correlation.groupAlertsIntoProblems(unrelated, { environment: testEnv });
  assert.strictEqual(unrelatedProblems.length, 2, '2 unrelated alerts must make 2 problems');
  assert.ok(unrelatedProblems.every(p => p.top_layer === 'unknown'), 'Unrelated alerts get layer unknown');
  console.log('✔ Problem Grouping: no evidence -> layer unknown; unrelated alerts -> separate problems.');

  console.log('✅ [TEST PASS] Phase 4 Correlation Engine Replay Scenario & M3/M5 Layer Diagnoses Succeeded completely.');
}

if (require.main === module) {
  runCorrelationReplayTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ [TEST FAILED]', err);
      process.exit(1);
    });
}

module.exports = { runCorrelationReplayTest };
