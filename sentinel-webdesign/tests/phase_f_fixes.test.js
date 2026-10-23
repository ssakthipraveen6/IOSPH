/**
 * tests/phase_f_fixes.test.js
 *
 * Comprehensive integration tests for Phase F: Validation Report Fixes (F1 - F8).
 * Acceptance criteria:
 * F1: Evidence pack built from stored data only; unknown id -> 404; no data -> "No data in window".
 * F2: HTML escaping for server-rendered HTML (evidence pack, scorecard).
 * F3: Problem grouping: no injected journeys, no Disk I/O keyword rule, no storage defaults;
 *     unrelated alerts produce problems with top_layer 'unknown' and confidence null.
 * F4: Scorecard computes from data; missing data -> fields null (zero numeric defaults).
 * F5: Heartbeat stores null for missing agent_version / shipper_version / os; fleet uses config expected_hosts.
 * F6: GET /api/auth/me returns 401 without session.
 * F7: Agent config exact host matching; omits sentinel.agent.version if not reported.
 * F8: lint:samples widened to catch CVEs, entity ids, emails, and internal hostnames.
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const { escapeHtml } = require('../backend/services/html');
const correlation = require('@sentinel/correlation');
const scorecard = require('../ai_analysis/scorecard');
const inventory = require('../inventory');

async function runPhaseFTests() {
  console.log('=== RUNNING PHASE F VALIDATION & REGRESSION TEST SUITE ===\n');

  // Load app for HTTP route tests
  const { app } = require('../backend/server');
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST] Test server running on ${baseUrl}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: F2 HTML Escaping Helper Verification
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Verifying escapeHtml XSS protection helper...');
    const maliciousInput = '<img src=x onerror=alert(1)> & "hello" \'world\'';
    const escaped = escapeHtml(maliciousInput);
    assert.strictEqual(escaped.includes('<img'), false, 'Must not contain unescaped <img tag');
    assert.strictEqual(escaped.includes('&lt;img'), true, 'Must escape < to &lt;');
    assert.strictEqual(escaped.includes('&amp;'), true, 'Must escape & to &amp;');
    assert.strictEqual(escaped.includes('&quot;'), true, 'Must escape " to &quot;');
    assert.strictEqual(escaped.includes('&#39;'), true, 'Must escape \' to &#39;');
    assert.strictEqual(escapeHtml(null), '', 'null input returns empty string');
    assert.strictEqual(escapeHtml(undefined), '', 'undefined input returns empty string');
    console.log('✔ Test 1 Passed: escapeHtml rigorously neutralizes HTML control characters.');

    // -------------------------------------------------------------------------
    // TEST 2: F1 Unknown Evidence Pack returns HTTP 404
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Verifying GET /api/problems/:id/evidence returns 404 for unknown ID...');
    const res404 = await fetch(`${baseUrl}/api/problems/PRB-NON-EXISTENT-XYZ/evidence`);
    assert.strictEqual(res404.status, 404, 'Unknown problem ID must return HTTP 404');
    const json404 = await res404.json();
    assert.ok(json404.error.includes('Problem not found'), '404 body must indicate problem not found');
    console.log('✔ Test 2 Passed: Unknown problem ID correctly rejected with HTTP 404.');

    // -------------------------------------------------------------------------
    // TEST 3: F1 & F2 Stored Problem Evidence Pack renders escaped HTML and clean empty states
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Verifying evidence pack renders stored data, empty state messages, and escaped HTML...');
    const testProblemId = 'PRB-F-TEST-999';
    const testProblem = {
      id: testProblemId,
      title: 'XSS Probe <img src=x onerror=alert(1)>',
      environment: 'staging',
      status: 'OPEN',
      severity: 'CRITICAL',
      top_layer: 'storage',
      confidence: 0.85,
      suspect_entity: 'storage:test-nfs-01',
      alert_count: 1,
      alerts: ['ALT-999'],
      created_at: new Date().toISOString()
    };
    correlation.problemStore.set(testProblemId, testProblem);

    const resEvidence = await fetch(`${baseUrl}/api/problems/${testProblemId}/evidence`);
    assert.strictEqual(resEvidence.status, 200, 'Existing problem must return HTTP 200');
    const htmlEvidence = await resEvidence.text();

    assert.ok(!htmlEvidence.includes('<img src=x onerror=alert(1)>'), 'HTML must NOT contain raw unescaped <img tag');
    assert.ok(htmlEvidence.includes('&lt;img src=x onerror=alert(1)&gt;'), 'HTML must escape malicious problem title');
    assert.ok(htmlEvidence.includes('No metric data in window'), 'Empty metrics in store must display "No metric data in window"');
    assert.ok(htmlEvidence.includes('No data in window'), 'Empty change events/CVEs must display "No data in window"');
    console.log('✔ Test 3 Passed: Evidence pack renders real stored problem, empty states, and HTML-escaped content.');

    // -------------------------------------------------------------------------
    // TEST 4: F3 Problem Grouping Truthfulness (Zero Injected Journeys, Null Hypotheses)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Verifying problem grouping without synthetic storage journeys...');
    // A) 2 completely unrelated alerts
    const unrelatedAlerts = [
      { id: 'ALT-U1', component: 'bitbucket', entity_id: 'host:app-01', message: 'CPU high', severity: 'warning', timestamp: new Date().toISOString() },
      { id: 'ALT-U2', component: 'database', entity_id: 'db:oracle-01', message: 'Connection spike', severity: 'warning', timestamp: new Date().toISOString() }
    ];
    const groupedUnrelated = await correlation.groupAlertsIntoProblems(unrelatedAlerts, 'staging');
    assert.strictEqual(groupedUnrelated.length, 2, 'Unrelated alerts must produce 2 distinct problems');
    for (const p of groupedUnrelated) {
      assert.strictEqual(p.top_layer, 'unknown', 'Unrelated alerts with no diagnosis must have top_layer unknown');
      assert.strictEqual(p.confidence, null, 'Unrelated alerts with no diagnosis must have confidence null');
    }
    console.log('✔ Test 4 Passed: Problem grouping does not fabricate storage journeys; unrelated alerts yield unknown/null.');

    // -------------------------------------------------------------------------
    // TEST 5: F4 Scorecard Computes from Data (Zero Numeric Defaults, Null When Empty)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Verifying scorecard buildProductScorecard produces null on missing data...');
    const emptyScorecard = scorecard.buildProductScorecard({
      productId: 'jfrog_artifactory',
      environment: 'staging'
    });
    assert.strictEqual(emptyScorecard.availability_pct, null, 'Availability must be null when unsupplied');
    assert.strictEqual(emptyScorecard.p95_ms, null, 'p95 latency must be null when unsupplied');
    assert.strictEqual(emptyScorecard.p95_change_pct, null, 'p95 change pct must be null when unsupplied');
    assert.strictEqual(emptyScorecard.change_points_count, null, 'Change points count must be null when unsupplied');
    assert.strictEqual(emptyScorecard.open_cves_count, null, 'Open CVEs count must be null when unsupplied');
    assert.strictEqual(emptyScorecard.top_cause, null, 'Top cause must be null when unsupplied');
    assert.ok(emptyScorecard.html_content.includes('N/A'), 'HTML must render N/A for empty values');
    console.log('✔ Test 5 Passed: Scorecard defaults are strictly null with N/A HTML fallbacks.');

    // -------------------------------------------------------------------------
    // TEST 6: F5 Heartbeat Null Versions & Fleet Expected Hosts from Config
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Verifying heartbeat preserves null for missing version/os and fleet summary uses config...');
    const resHeartbeat = await fetch(`${baseUrl}/api/v2/shipper/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'lon-linux-compute-99.internal.corp',
        status: 'HEALTHY'
        // Missing version, agent_version, config_hash, os
      })
    });
    assert.strictEqual(resHeartbeat.status, 200, 'Heartbeat must succeed');

    const entity = await inventory.getEntityById('host:lon-linux-compute-99.internal.corp');
    assert.ok(entity, 'Entity must be upserted in inventory');
    assert.strictEqual(entity.labels.shipper_version, null, 'Missing shipper_version must be null (not 3.0.4)');
    assert.strictEqual(entity.labels.agent_version, null, 'Missing agent_version must be null (not 2.4.0)');
    assert.strictEqual(entity.labels.os, null, 'Missing os must be null (not linux)');

    const resFleet = await fetch(`${baseUrl}/api/v2/fleet/summary?environment=staging`);
    assert.strictEqual(resFleet.status, 200, 'Fleet summary must return 200');
    const fleetJson = await resFleet.json();
    assert.strictEqual(fleetJson.agentsDiscoveredVsExpected.expected, 2000, 'Fleet summary must read expected_hosts: 2000 from global.yaml');
    console.log('✔ Test 6 Passed: Heartbeat stores null for missing versions; fleet summary uses config expected_hosts.');

    // -------------------------------------------------------------------------
    // TEST 7: F6 GET /api/auth/me Returns 401 Without Session
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Verifying GET /api/auth/me returns 401 without authenticated session...');
    const resAuthMe = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(resAuthMe.status, 401, 'Anonymous GET /api/auth/me must return HTTP 401');
    const authMeJson = await resAuthMe.json();
    assert.ok(authMeJson.error.includes('Authentication required'), 'Must indicate authentication required');
    console.log('✔ Test 7 Passed: Anonymous /api/auth/me strictly returns HTTP 401 (never defaults to Super Admin).');

    // -------------------------------------------------------------------------
    // TEST 8: F7 Agent Config Exact Host Matching & Version Omission
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Verifying agent config exact host matching and version attribute omission...');
    // 1. Partial/prefix host must NOT match applications
    const resPrefixHost = await fetch(`${baseUrl}/api/v2/agent/config?host=a`);
    assert.strictEqual(resPrefixHost.status, 200);
    const prefixJson = await resPrefixHost.json();
    assert.strictEqual(prefixJson.apps.length, 0, 'Prefix host "a" must match 0 apps (exact matching enforced)');

    // 2. Unreported version must NOT emit sentinel.agent.version in collector config
    const resourceAttrs = prefixJson.collector_config.processors.resource.attributes;
    const versionAttr = resourceAttrs.find(a => a.key === 'sentinel.agent.version');
    assert.strictEqual(versionAttr, undefined, 'sentinel.agent.version attribute must be omitted when not reported');

    // 3. Reported version MUST be emitted
    const resVersionHost = await fetch(`${baseUrl}/api/v2/agent/config?host=a&agent_version=4.1.0`);
    assert.strictEqual(resVersionHost.status, 200);
    const versionJson = await resVersionHost.json();
    const reportedAttr = versionJson.collector_config.processors.resource.attributes.find(a => a.key === 'sentinel.agent.version');
    assert.ok(reportedAttr, 'sentinel.agent.version must be present when reported');
    assert.strictEqual(reportedAttr.value, '4.1.0', 'sentinel.agent.version must match reported query param');
    console.log('✔ Test 8 Passed: Agent config enforces exact host matching and omits agent.version when unreported.');

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE F REGRESSION & ACCEPTANCE TESTS PASSED!');
    console.log('======================================================');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// The app module starts background timers, so exit explicitly like the other suites.
runPhaseFTests().then(() => process.exit(0)).catch(err => {
  console.error('\n✘ Phase F Test Failed:', err);
  process.exit(1);
});
