/**
 * tests/phase_o10_sre_extras.test.js
 *
 * Phase O10 Acceptance Tests:
 * - O10.1: SLO burn-rate alerts (fast 14.4x & slow 6x) on golden journeys
 * - O10.3: Alert hygiene: flapping detection (>= 4 transitions in 30m)
 * - O10.4: runbook_url & evidence_pack_url attached to triggered alerts
 * - O10.5: NTP offset alerts (>500ms warning, >2000ms critical)
 * - O10.6: Platform health agent self-monitoring (dropped batches, exporter errors, silent agents)
 * - O10.7: Weekly capacity runway report (items full within 30 days & Teams markdown)
 * - O10.9: Second vantage point synthetic execution tagging (vantage: true, vantage_host)
 * - O10.10: Database backup age alert (>24h)
 * - O10.11: Unapproved config drift alert
 * - O10.12: Monthly reliability report (JSON & escaped HTML with MTTD/MTTR/SLO)
 * - O10.13: Shared-dependency blast radius impact in app map
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const path = require('path');

const {
  evaluateRule,
  loadRules,
  recordAlertTransition,
  isAlertFlapping,
  clearAlertTransitions
} = require('../ai_analysis/alert_engine');

const { SyntheticsRunner } = require('../synthetics/runner');
const platformRoutes = require('../backend/routes/platformRoutes');
const reportRoutes = require('../backend/routes/reportRoutes');
const componentRoutes = require('../backend/routes/componentRoutes');
const appMapRoutes = require('../backend/routes/appMapRoutes');
const problemStore = require('../correlation/problem_store');

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function fetchJson(url, options = {}) {
  const parsed = new URL(url);
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.stringify(options.body) : null;
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (_) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('[TEST] Starting Phase O10 SRE Extras acceptance tests...');

  // --------------------------------------------------------------------------
  // 1. O10.1 & O10.4: SLO Burn-Rate Rules & Runbook URL Validation
  // --------------------------------------------------------------------------
  console.log('[TEST] 1. SLO burn-rate evaluation (fast 14.4x & slow 6x)...');
  const rules = loadRules();
  const fastRule = rules.find(r => r.id === 'rule_slo_burn_rate_fast');
  const slowRule = rules.find(r => r.id === 'rule_slo_burn_rate_slow');

  assert.ok(fastRule, 'rule_slo_burn_rate_fast must be defined in config/alerts/rules.yaml');
  assert.ok(slowRule, 'rule_slo_burn_rate_slow must be defined in config/alerts/rules.yaml');
  assert.ok(fastRule.runbook_url, 'fast burn rate rule must define runbook_url');
  assert.ok(slowRule.runbook_url, 'slow burn rate rule must define runbook_url');

  // Fast window: 99% SLO -> 1% error budget. 15% error rate = 15x burn rate >= 14.4x -> TRIGGERED
  const fastTriggered = await evaluateRule(fastRule, {
    env: 'staging',
    component: 'bitbucket',
    error_rate: 15.0
  });
  assert.ok(fastTriggered, '15% error rate on 99% SLO must trigger fast burn rate alert');
  assert.strictEqual(fastTriggered.rule_id, 'rule_slo_burn_rate_fast');
  assert.strictEqual(fastTriggered.runbook_url, fastRule.runbook_url);
  assert.ok(fastTriggered.evidence_pack_url.includes('rule_slo_burn_rate_fast'));

  // Fast window below threshold: 5% error rate = 5x burn rate < 14.4x -> NOT TRIGGERED
  const fastNotTriggered = await evaluateRule(fastRule, {
    env: 'staging',
    component: 'bitbucket',
    error_rate: 5.0
  });
  assert.strictEqual(fastNotTriggered, null, '5x burn rate must NOT trigger fast alert');

  // Slow window: 99% SLO -> 1% error budget. 7% error rate = 7x burn rate >= 6.0x -> TRIGGERED
  const slowTriggered = await evaluateRule(slowRule, {
    env: 'staging',
    component: 'cloudbees_jenkins',
    error_rate: 7.0
  });
  assert.ok(slowTriggered, '7x burn rate must trigger slow burn rate alert');
  assert.strictEqual(slowTriggered.rule_id, 'rule_slo_burn_rate_slow');

  // --------------------------------------------------------------------------
  // 2. O10.3: Alert Hygiene & Flapping Detection
  // --------------------------------------------------------------------------
  console.log('[TEST] 2. Alert flapping detection...');
  clearAlertTransitions();
  const alertKey = 'bitbucket:high_error_rate';
  const now = Date.now();

  // 2 transitions -> not flapping
  recordAlertTransition(alertKey, 'firing', now - 20 * 60 * 1000);
  recordAlertTransition(alertKey, 'resolved', now - 15 * 60 * 1000);
  assert.strictEqual(isAlertFlapping(alertKey, now), false, '2 transitions must not be flapping');

  // 4 state changes (5 records) within 30 min window -> FLAPPING
  recordAlertTransition(alertKey, 'firing', now - 10 * 60 * 1000);
  recordAlertTransition(alertKey, 'resolved', now - 5 * 60 * 1000);
  const transition5 = recordAlertTransition(alertKey, 'firing', now - 1 * 60 * 1000);
  assert.strictEqual(transition5.isFlapping, true, '4 state transitions in 30 min must flag flapping');
  assert.strictEqual(isAlertFlapping(alertKey, now), true);

  // Transitions older than 30 mins are pruned
  const futureNow = now + 35 * 60 * 1000;
  assert.strictEqual(isAlertFlapping(alertKey, futureNow), false, 'Transitions outside 30m window must be pruned');

  // --------------------------------------------------------------------------
  // 3. O10.5: NTP Offset Alerts
  // --------------------------------------------------------------------------
  console.log('[TEST] 3. NTP offset alerts (>500ms warning, >2000ms critical)...');
  const ntpWarnRule = rules.find(r => r.id === 'rule_ntp_offset_warning');
  const ntpCritRule = rules.find(r => r.id === 'rule_ntp_offset_critical');
  assert.ok(ntpWarnRule, 'rule_ntp_offset_warning must exist');
  assert.ok(ntpCritRule, 'rule_ntp_offset_critical must exist');

  const ntpWarnRes = await evaluateRule(ntpWarnRule, {
    values: { 'system.ntp.offset_ms': 620 }
  });
  assert.ok(ntpWarnRes, '620ms NTP offset must trigger warning alert');
  assert.strictEqual(ntpWarnRes.severity.toLowerCase(), 'warning');

  const ntpCritRes = await evaluateRule(ntpCritRule, {
    values: { 'system.ntp.offset_ms': 2500 }
  });
  assert.ok(ntpCritRes, '2500ms NTP offset must trigger critical alert');
  assert.strictEqual(ntpCritRes.severity.toLowerCase(), 'critical');

  // --------------------------------------------------------------------------
  // 4. O10.10 & O10.11: Database Backup Age & Unapproved Config Drift
  // --------------------------------------------------------------------------
  console.log('[TEST] 4. DB backup age and unapproved config drift...');
  const dbBackupRule = rules.find(r => r.id === 'rule_database_backup_age');
  const configDriftRule = rules.find(r => r.id === 'rule_unapproved_config_change');
  assert.ok(dbBackupRule, 'rule_database_backup_age must exist');
  assert.ok(configDriftRule, 'rule_unapproved_config_change must exist');

  const dbBackupRes = await evaluateRule(dbBackupRule, {
    values: { 'database.backup.age_hours': 28 }
  });
  assert.ok(dbBackupRes, 'Backup age 28h must trigger alert (>24h)');

  const configDriftRes = await evaluateRule(configDriftRule, {
    values: { 'config.drift.unapproved_count': 1 }
  });
  assert.ok(configDriftRes, 'Unapproved config change count > 0 must trigger alert');

  // --------------------------------------------------------------------------
  // 5. O10.6: Platform Health Agent Self-Monitoring API
  // --------------------------------------------------------------------------
  console.log('[TEST] 5. Platform health agent self-monitoring API...');
  const appPlatform = express();
  appPlatform.use((req, res, next) => {
    req.sentinelEnv = 'staging';
    req.agents_total = 12;
    req.silent_agents = 0;
    next();
  });
  appPlatform.use('/api/v2/platform', platformRoutes);
  const serverPlatform = http.createServer(appPlatform);
  const portPlatform = await listen(serverPlatform);

  try {
    const res = await fetchJson(`http://127.0.0.1:${portPlatform}/api/v2/platform/health`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.agents, 'health response must include agents block');
    assert.strictEqual(res.body.agents.total_registered, 12);
    assert.strictEqual(typeof res.body.agents.dropped_batches_total, 'number');
    assert.strictEqual(typeof res.body.agents.exporter_errors_count, 'number');
    assert.strictEqual(typeof res.body.agents.silent_agents_count, 'number');
  } finally {
    serverPlatform.close();
  }

  // --------------------------------------------------------------------------
  // 6. O10.7: Weekly Capacity Runway Report API
  // --------------------------------------------------------------------------
  console.log('[TEST] 6. Weekly capacity runway report API...');
  const appCap = express();
  appCap.use((req, res, next) => {
    req.sentinelEnv = 'staging';
    req.capacityItems = [
      { id: 'host-01', name: 'app-host-01', component: 'bitbucket', used_pct: 92, min_days_to_full: 5 },
      { id: 'db-01', name: 'db-oracle-01', component: 'bitbucket', used_pct: 85, min_days_to_full: 22 },
      { id: 'host-02', name: 'app-host-02', component: 'jenkins', used_pct: 40, min_days_to_full: 120 }
    ];
    next();
  });
  appCap.use('/api/v2/capacity', componentRoutes.capacityRouter);
  const serverCap = http.createServer(appCap);
  const portCap = await listen(serverCap);

  try {
    const res = await fetchJson(`http://127.0.0.1:${portCap}/api/v2/capacity/report`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total_at_risk, 2, 'Only items with min_days_to_full <= 30 must be in report');
    assert.strictEqual(res.body.critical_count, 1, 'Items <= 7 days must be critical');
    assert.strictEqual(res.body.warning_count, 1, 'Items between 8 and 30 days must be warning');
    assert.ok(res.body.teams_summary.includes('Weekly Capacity Runway Report'));
    assert.ok(res.body.teams_summary.includes('app-host-01'));
  } finally {
    serverCap.close();
  }

  // --------------------------------------------------------------------------
  // 7. O10.12: Monthly Reliability Report (JSON & Escaped HTML)
  // --------------------------------------------------------------------------
  console.log('[TEST] 7. Monthly reliability report (JSON and HTML format)...');
  const appReport = express();
  appReport.use((req, res, next) => {
    req.sentinelEnv = 'staging';
    next();
  });
  appReport.use('/api/v2/reports', reportRoutes);
  const serverReport = http.createServer(appReport);
  const portReport = await listen(serverReport);

  try {
    // JSON response
    const jsonRes = await fetchJson(`http://127.0.0.1:${portReport}/api/v2/reports/reliability`);
    assert.strictEqual(jsonRes.status, 200);
    assert.ok(typeof jsonRes.body.availability_pct === 'number');
    assert.ok(typeof jsonRes.body.mttd_minutes === 'number');
    assert.ok(typeof jsonRes.body.mttr_minutes === 'number');
    assert.ok(Array.isArray(jsonRes.body.slo_status));
    assert.ok(jsonRes.body.slo_status.length > 0);

    // HTML response
    const htmlRes = await fetchJson(`http://127.0.0.1:${portReport}/api/v2/reports/reliability?format=html`);
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(htmlRes.headers['content-type'].includes('text/html'));
    assert.ok(htmlRes.text.includes('<!DOCTYPE html>'));
    assert.ok(htmlRes.text.includes('Toolchain Availability'));
    assert.ok(htmlRes.text.includes('Golden Journey SLO Conformance'));
  } finally {
    serverReport.close();
  }

  // --------------------------------------------------------------------------
  // 8. O10.9: Vantage Point Synthetic Execution Tagging
  // --------------------------------------------------------------------------
  console.log('[TEST] 8. Synthetic runner vantage point tagging...');
  const fakeDbManager = { addMetricBatch: () => {} };
  const runner = new SyntheticsRunner({
    dbManager: fakeDbManager,
    isLeaderCheck: () => true
  });

  const testJourneyWithVantage = {
    id: 'test_journey_vantage',
    name: 'Test Vantage Journey',
    vantage_hosts: ['vantage-agent-dc2'],
    steps: [
      { id: 'vantage_step_1', type: 'http', action: 'get', url: 'http://127.0.0.1:9' } // will fail fast or simulate
    ]
  };

  const record = await runner.runJourney('test_app', testJourneyWithVantage, 'staging');
  assert.strictEqual(record.vantage, true, 'runRecord must be tagged with vantage: true');
  assert.strictEqual(record.vantage_host, 'vantage-agent-dc2', 'runRecord must capture vantage_host');

  const rootSpan = record.spans.find(s => s.name.startsWith('Test Vantage Journey'));
  assert.ok(rootSpan, 'root span must exist');
  assert.strictEqual(rootSpan.attributes.vantage, true, 'root span must have vantage: true');
  assert.strictEqual(rootSpan.attributes.vantage_host, 'vantage-agent-dc2');

  // Also when options.vantage_host is explicitly passed
  const normalJourney = {
    id: 'test_normal_journey',
    steps: []
  };
  const recordOptions = await runner.runJourney('test_app', normalJourney, 'staging', { vantage_host: 'custom-probe-01' });
  assert.strictEqual(recordOptions.vantage, true);
  assert.strictEqual(recordOptions.vantage_host, 'custom-probe-01');

  // --------------------------------------------------------------------------
  // 9. O10.13: Shared-Dependency Blast Radius Impact in Application Map
  // --------------------------------------------------------------------------
  console.log('[TEST] 9. Shared-dependency degradation propagation on app map...');
  const appMapExpress = express();
  appMapExpress.use((req, res, next) => {
    req.sentinelEnv = 'staging';
    next();
  });
  appMapExpress.use('/api/v2/apps', appMapRoutes);
  const serverMap = http.createServer(appMapExpress);
  const portMap = await listen(serverMap);

  try {
    // Inject a problem on shared NAS storage (/data/shared or nas-enterprise-01)
    if (problemStore && typeof problemStore.recordProblem === 'function') {
      await problemStore.recordProblem({
        id: 'prob-nas-exhaustion-01',
        title: 'Shared NAS storage volume exhausted',
        environment: 'staging',
        severity: 'critical',
        suspect_entity: 'nas-enterprise-01',
        suspect_layer: 'storage',
        top_layer: 'storage',
        status: 'open',
        created_at: new Date().toISOString()
      });
    }

    const res = await fetchJson(`http://127.0.0.1:${portMap}/api/v2/apps/bitbucket/map`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.layers), 'app map must return layers array');

    // Find storage layer or node
    const storageLayer = res.body.layers.find(l => l.kind === 'storage' || l.id === 'storage');
    if (storageLayer) {
      assert.strictEqual(storageLayer.status, 'failing', 'Storage layer matching degraded shared entity must be failing');
      // Downstream layers (database, dependencies, app) after storage should be affected_downstream
      const downstream = res.body.layers.filter(l => l.status === 'affected_downstream');
      assert.ok(downstream.length > 0, 'Downstream layers after failing shared dependency must be marked affected_downstream');
    }
  } finally {
    serverMap.close();
  }

  console.log('[TEST] Phase O10 SRE Extras tests all passed successfully!');
}

main().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
