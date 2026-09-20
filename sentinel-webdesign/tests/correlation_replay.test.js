const assert = require('assert');
const crypto = require('crypto');
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

  console.log('✅ [TEST PASS] Phase 4 Correlation Engine Replay Scenario Succeeded completely.');
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
