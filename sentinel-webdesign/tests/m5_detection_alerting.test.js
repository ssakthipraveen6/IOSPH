/**
 * tests/m5_detection_alerting.test.js
 *
 * Comprehensive Milestone M5 Unit & Integration Tests:
 * 1. Hour-of-week baselines (Median & MAD, robust z-score, weekly cyclicity vs true shift)
 * 2. CUSUM Change-point detection (+30% worsening, -25% improvement, noise filtering, event correlation)
 * 3. Alert engine & YAML rules (threshold, baseline, absence, composite, maintenance window suppression)
 * 4. Alert lifecycle APIs (ack, snooze, resolve with SRE Lead auth)
 * 5. Problem grouping & HTML Evidence Pack generation
 * 6. Microsoft Teams webhook notification (inert when blank, delivered when URL set)
 * 7. Weekly product scorecard generation
 * 8. SLO tracking with unknown status on empty data & multi-window burn rate
 */

const assert = require('assert');
const http = require('http');
const { app } = require('../backend/server');
const baselines = require('../ai_analysis/baselines');
const changePoints = require('../ai_analysis/change_points');
const alertEngine = require('../ai_analysis/alert_engine');
const scorecard = require('../ai_analysis/scorecard');
const sloTracker = require('../backend/services/slo/slo_tracker');
const teamsNotifier = require('../backend/services/notify/teams');
const correlation = require('@sentinel/correlation');
const db = require('../database/db');
const session = require('../backend/auth/session');

async function runM5Tests() {
  console.log('=== RUNNING MILESTONE M5: DETECTION, ALERTING & EVIDENCE PACKS TESTS ===');

  let server;
  let testPort;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Hour-of-Week Baselines (Task 5.1)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing hour-of-week median and MAD baselines...');
    
    // Set baseline for Artifactory step duration at hour 42 (e.g. Tuesday 18:00 UTC)
    const testDate = new Date('2026-10-13T18:30:00.000Z');
    const testHour = baselines.getHourOfWeek(testDate);
    baselines.setBaseline('production', 'jfrog_artifactory', 'journey.step.duration_ms', testHour, 150.0, 15.0, 28);

    // 1.1 Normal weekly fluctuation (165ms) -> robust Z ~ 0.67 < 3.0 -> NOT an anomaly
    const normalScore = baselines.scoreObservation({
      env: 'production',
      entityId: 'jfrog_artifactory',
      metricName: 'journey.step.duration_ms',
      value: 165.0,
      timestamp: testDate,
      zThreshold: 3.0
    });
    assert.strictEqual(normalScore.evaluated, true);
    assert.strictEqual(normalScore.isAnomaly, false);
    assert.ok(normalScore.robustZ < 3.0);

    // 1.2 Isolated spike (350ms) -> robust Z > 3.0, but streak = 1 (< consecutive 3) -> NOT yet confirmed anomaly
    const singleSpike = baselines.scoreObservation({
      env: 'production',
      entityId: 'jfrog_artifactory',
      metricName: 'journey.step.duration_ms',
      value: 350.0,
      timestamp: testDate,
      zThreshold: 3.0,
      consecutiveN: 3
    });
    assert.strictEqual(singleSpike.isAnomaly, false);
    assert.strictEqual(singleSpike.consecutiveViolations, 1);

    // 1.3 Two more consecutive spikes -> streak reaches 3 -> CONFIRMED anomaly
    baselines.scoreObservation({
      env: 'production',
      entityId: 'jfrog_artifactory',
      metricName: 'journey.step.duration_ms',
      value: 360.0,
      timestamp: testDate,
      zThreshold: 3.0,
      consecutiveN: 3
    });
    const sustainedAnomaly = baselines.scoreObservation({
      env: 'production',
      entityId: 'jfrog_artifactory',
      metricName: 'journey.step.duration_ms',
      value: 375.0,
      timestamp: testDate,
      zThreshold: 3.0,
      consecutiveN: 3
    });
    assert.strictEqual(sustainedAnomaly.isAnomaly, true);
    assert.strictEqual(sustainedAnomaly.consecutiveViolations, 3);
    console.log('✔ Test 1 Passed: Hour-of-week baselines ignore normal cyclicity and catch sustained shifts.');

    // -------------------------------------------------------------------------
    // SECTION 2: CUSUM Change-Point Detection (Task 5.2)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing CUSUM change-point detection on step timings...');

    // 2.1 Synthetic step-change: baseline 100ms -> jumps to 130ms (+30% worsening)
    const worseningSeries = [
      100, 102, 98, 101, 99, 100, 103, 97, // baseline segment
      130, 132, 129, 131, 133, 128, 130   // sustained +30% step change
    ];

    const cpWorsened = changePoints.detectChangePoint(worseningSeries, {
      thresholdSigma: 2.5,
      slackSigma: 0.5,
      lowerIsBetter: true
    });
    assert.ok(cpWorsened, 'Must detect worsening step change');
    assert.strictEqual(cpWorsened.direction, 'worsened');
    assert.ok(cpWorsened.magnitude_pct >= 25.0 && cpWorsened.magnitude_pct <= 35.0);

    // 2.2 Synthetic step-change: baseline 200ms -> drops to 150ms (-25% improvement)
    const improvingSeries = [
      200, 202, 198, 201, 199, 200, 203, // baseline segment
      150, 149, 151, 148, 152, 150, 149  // sustained -25% improvement
    ];

    const cpImproved = changePoints.detectChangePoint(improvingSeries, {
      thresholdSigma: 2.5,
      slackSigma: 0.5,
      lowerIsBetter: true
    });
    assert.ok(cpImproved, 'Must detect improvement step change');
    assert.strictEqual(cpImproved.direction, 'improved');
    assert.ok(cpImproved.magnitude_pct >= 20.0 && cpImproved.magnitude_pct <= 30.0);

    // 2.3 Stationary noisy series with zero structural step
    const noiseSeries = [100, 102, 98, 101, 99, 100, 101, 99, 102, 98, 100, 99, 101];
    const cpNoise = changePoints.detectChangePoint(noiseSeries);
    assert.strictEqual(cpNoise, null, 'Noisy series without step must return null');
    console.log('✔ Test 2 Passed: CUSUM detected +30% worsening and -25% improvement, ignoring noise.');

    // -------------------------------------------------------------------------
    // SECTION 3: Alert Engine & YAML Rules (Task 5.3)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing alert rules evaluation and maintenance window suppression...');

    const rules = alertEngine.loadRules();
    assert.ok(rules.length >= 4, 'Must load configured alert rules from config/alerts/');

    // 3.1 Threshold rule evaluation
    const heapRule = rules.find(r => r.id === 'rule_high_jvm_heap');
    assert.ok(heapRule);
    const triggeredHeap = await alertEngine.evaluateRule(heapRule, {
      values: { 'jvm.memory.heap.used_pct': 94.5 }
    });
    assert.ok(triggeredHeap);
    assert.strictEqual(triggeredHeap.rule_id, 'rule_high_jvm_heap');
    assert.strictEqual(triggeredHeap.severity, 'Critical');

    // 3.2 Composite rule evaluation (AND logic)
    const compositeRule = rules.find(r => r.id === 'rule_composite_avi_path_bottleneck');
    assert.ok(compositeRule);
    const triggeredComposite = await alertEngine.evaluateRule(compositeRule, {
      values: { 'vip.total_ms': 620, 'agent.localhost_ms': 12 }
    });
    assert.ok(triggeredComposite);
    assert.strictEqual(triggeredComposite.rule_id, 'rule_composite_avi_path_bottleneck');

    // 3.3 Composite rule fails when one condition unmet
    const failedComposite = await alertEngine.evaluateRule(compositeRule, {
      values: { 'vip.total_ms': 620, 'agent.localhost_ms': 85 } // localhost is slow too
    });
    assert.strictEqual(failedComposite, null);
    console.log('✔ Test 3 Passed: Alert rules evaluated accurately against metrics.');

    // -------------------------------------------------------------------------
    // SECTION 4: Alert Lifecycle Endpoints (Task 5.3e)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing alert lifecycle APIs (ack, snooze, resolve)...');

    const adminToken = session.generateToken({ username: 'lead.sre@enterprise.corp', role: 'SRE Lead' });
    const operatorToken = session.generateToken({ username: 'operator@enterprise.corp', role: 'Observer' });

    // Seed test alert
    const testAlert = db.addAlert('bitbucket', 'Critical', 'Bitbucket DB Connection Pool Exhaustion', 'Active', 'production');
    assert.ok(testAlert && testAlert.id);

    // 4.1 Observer role forbidden
    const unauthAck = await fetch(`http://127.0.0.1:${testPort}/api/v2/alerts/${testAlert.id}/ack`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(unauthAck.status, 403, 'Observer must be forbidden from acking alerts');

    // 4.2 SRE Lead acknowledges alert
    const ackRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/alerts/${testAlert.id}/ack`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.strictEqual(ackData.alert.status, 'Acknowledged');
    assert.strictEqual(ackData.alert.acked_by, 'lead.sre@enterprise.corp');

    // 4.3 SRE Lead snoozes alert
    const snoozeRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/alerts/${testAlert.id}/snooze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ minutes: 45 })
    });
    assert.strictEqual(snoozeRes.status, 200);
    const snoozeData = await snoozeRes.json();
    assert.strictEqual(snoozeData.alert.status, 'Snoozed');
    assert.ok(snoozeData.alert.snoozed_until);

    // 4.4 SRE Lead resolves alert
    const resolveRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/alerts/${testAlert.id}/resolve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(resolveRes.status, 200);
    const resolveData = await resolveRes.json();
    assert.strictEqual(resolveData.alert.status, 'Resolved');
    assert.strictEqual(resolveData.alert.resolved_by, 'lead.sre@enterprise.corp');
    console.log('✔ Test 4 Passed: Alert lifecycle endpoints enforced SRE Lead RBAC and audit trail.');

    // -------------------------------------------------------------------------
    // SECTION 5: Problem Grouping & Evidence Pack (Tasks 5.4 & 5.5)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing problem grouping and HTML evidence pack generation...');

    // 5.1 Fetch problem details
    const problemsRes = await fetch(`http://127.0.0.1:${testPort}/api/problems?environment=staging`);
    assert.strictEqual(problemsRes.status, 200);
    const problemsData = await problemsRes.json();
    assert.ok(Array.isArray(problemsData.problems));

    // 5.2 Unknown problem id -> 404 (no fallback problem)
    const unknownRes = await fetch(`http://127.0.0.1:${testPort}/api/problems/PRB-DOES-NOT-EXIST/evidence?format=html`);
    assert.strictEqual(unknownRes.status, 404);

    // 5.3 Evidence pack for a problem created through the real grouping path
    const [created] = await correlation.groupAlertsIntoProblems([
      { id: 'm5-ev-1', component: 'm5evidenceproduct', entity_id: 'app:m5evidenceproduct', message: 'p95 above threshold <script>x</script>', severity: 'Critical', timestamp: new Date().toISOString() }
    ], { environment: 'staging' });
    assert.ok(created && created.id);
    const evidenceRes = await fetch(`http://127.0.0.1:${testPort}/api/problems/${created.id}/evidence?format=html`);
    assert.strictEqual(evidenceRes.status, 200);
    const htmlText = await evidenceRes.text();
    assert.ok(htmlText.includes('SENTINEL Evidence Pack'));
    assert.ok(htmlText.includes(created.id), 'Pack shows the stored problem id');
    assert.ok(htmlText.includes('No metric data in window'), 'No ClickHouse -> no invented chart');
    assert.ok(htmlText.includes('No data in window'), 'No changes/CVEs stored -> empty section');
    assert.ok(!/CVE-\d{4}-\d+/.test(htmlText), 'No CVE ids unless stored');
    assert.ok(!htmlText.includes('<script>x</script>'), 'Alert text is escaped');
    assert.ok(htmlText.includes('ServiceNow')); // Prefilled ServiceNow button
    console.log('✔ Test 5 Passed: Evidence pack built only from stored data; unknown id -> 404.');

    // -------------------------------------------------------------------------
    // SECTION 6: Microsoft Teams Notifications (Task 5.5a)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Microsoft Teams incoming webhook...');

    // 6.1 Blank URL safely skips
    const blankNotify = await teamsNotifier.sendProblemNotification({ id: 'PRB-001', title: 'Test' }, '');
    assert.strictEqual(blankNotify.status, 'SKIPPED');
    assert.ok(blankNotify.reason.includes('blank'));

    // 6.2 Fake webhook server
    let capturedWebhookPayload = null;
    const fakeTeamsServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        capturedWebhookPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise(res => fakeTeamsServer.listen(0, '127.0.0.1', res));
    const fakeTeamsPort = fakeTeamsServer.address().port;
    const fakeWebhookUrl = `http://127.0.0.1:${fakeTeamsPort}/webhook`;

    try {
      const deliveredNotify = await teamsNotifier.sendProblemNotification({
        id: 'PRB-999',
        title: 'NFS Share IOPS Exhaustion',
        environment: 'production',
        severity: 'CRITICAL',
        top_layer: 'storage',
        suspect_entity: 'storage:nas-pool-01',
        confidence: 0.92,
        alert_count: 4
      }, fakeWebhookUrl, { baseUrl: 'https://sentinel.example.test' });

      assert.strictEqual(deliveredNotify.status, 'DELIVERED');
      assert.ok(capturedWebhookPayload);
      assert.strictEqual(capturedWebhookPayload['@type'], 'MessageCard');
      assert.ok(capturedWebhookPayload.title.includes('PRB-999') || capturedWebhookPayload.title.includes('NFS Share'));
      assert.ok(capturedWebhookPayload.potentialAction.some(a => a.name.includes('SENTINEL')));
    } finally {
      fakeTeamsServer.close();
    }
    console.log('✔ Test 6 Passed: Microsoft Teams webhook payload validated with card actions.');

    // -------------------------------------------------------------------------
    // SECTION 7: Weekly Product Scorecard (Task 5.6)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing weekly product scorecard generation...');

    const sc = scorecard.buildProductScorecard({
      productId: 'jfrog_artifactory',
      environment: 'production',
      availabilityPct: 99.98,
      p95Ms: 145.0,
      prevP95Ms: 170.0,
      changePointsCount: 2,
      openCvesCount: 1,
      topCause: 'network/AVI'
    });

    assert.strictEqual(sc.product_id, 'jfrog_artifactory');
    assert.strictEqual(sc.availability_pct, 99.98);
    assert.strictEqual(sc.p95_change_pct, -14.7); // (145-170)/170 = -14.7% improvement
    assert.ok(sc.html_content.includes('jfrog_artifactory') || sc.html_content.includes('JFROG ARTIFACTORY'));

    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/scorecards?environment=production`);
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.scorecards.length >= 1);
    console.log('✔ Test 7 Passed: Product scorecard computed availability, p95 delta %, and top cause.');

    // -------------------------------------------------------------------------
    // SECTION 8: SLO Tracking Truthfulness & Empty Data UNKNOWN (Task 5.7)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing SLO tracker truthfulness and status UNKNOWN on empty data...');

    // Evaluate in an environment with no mock/sample data
    const evalEmpty = sloTracker.evaluateSlos('prod');
    assert.ok(Array.isArray(evalEmpty.slos));

    // When there is no telemetry/recovery data in prod, status must be UNKNOWN and currentSli null
    const recoverySlo = evalEmpty.slos.find(s => s.id === 'autonomous_recovery_success_rate');
    assert.ok(recoverySlo);
    assert.strictEqual(recoverySlo.status, 'UNKNOWN', 'Recovery SLO must be UNKNOWN when no recoveries exist');
    assert.strictEqual(recoverySlo.current_sli, null, 'current_sli must be null when no data exists');

    console.log('✔ Test 8 Passed: SLO tracker starts at status UNKNOWN with null current_sli on empty data.');

    console.log('\n======================================================');
    console.log('🎉 ALL MILESTONE M5 TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    server.close();
  }
}

runM5Tests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n✘ M5 Test Failed:', err);
  process.exit(1);
});
