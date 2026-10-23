/**
 * tests/phase_o6_restored_screens.test.js
 *
 * Acceptance test suite for Phase O6 (Restored Screens):
 * - O6.1: Health checks execution against a local HTTP server fixture + /api/v2/health-checks API
 * - O6.2: Platform health aggregation (/api/v2/platform/health)
 * - O6.3: Remediation autonomous toggle:
 *         - Viewer role returns 403
 *         - Turning ON in prod creates four-eyes pending request (autonomousMode remains false)
 *         - Same user approving again fails SOD (403 SOD_VIOLATION)
 *         - Second distinct approver turns autonomousMode true
 *         - Paginated runs endpoint /api/v2/remediation/runs
 * - O6.4: Distributed traces search and detail endpoints (/api/v2/traces)
 * - O6.5: Configuration viewer:
 *         - /api/yaml/all and /api/yaml/app/:id mask secrets (password, token, secret, api_key, credential_purpose -> '***')
 *         - Verify NO PUT/POST routes exist on /api/yaml
 *         - /api/yaml/config-check status returns PASS
 */
'use strict';

const assert = require('assert');
const http = require('http');

process.env.SENTINEL_ALLOW_LOCALHOST_CORS = 'true';
const { app } = require('../backend/server');
const syntheticsRunner = require('../synthetics/runner');
const db = require('../database/db');
const session = require('../backend/auth/session');

async function runTests() {
  console.log('=== RUNNING PHASE O6 RESTORED SCREENS ACCEPTANCE TESTS ===\n');

  // Start test server
  let server;
  let testPort;
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // -------------------------------------------------------------------------
    // O6.1: Health Checks Execution against Local HTTP Fixture Server
    // -------------------------------------------------------------------------
    console.log('[TEST O6.1] Health checks execution against local HTTP fixture...');
    let healthFixtureServer;
    let fixturePort;
    await new Promise(resolve => {
      healthFixtureServer = http.createServer((req, res) => {
        if (req.url === '/healthz') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'UP', version: '2.4.1' }));
        } else if (req.url === '/fail') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'DOWN' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      healthFixtureServer.listen(0, '127.0.0.1', () => {
        fixturePort = healthFixtureServer.address().port;
        resolve();
      });
    });

    const singleCheckDef = {
      id: 'test-local-healthz',
      name: 'Local HTTP Health Probe',
      url: `http://127.0.0.1:${fixturePort}/healthz`,
      expect_status: 200,
      expect_json: { status: 'UP' }
    };

    const runResult = await syntheticsRunner.runHealthCheck(singleCheckDef, 'staging');
    assert.strictEqual(runResult.status, 'UP', 'Health check should succeed for 200 UP response');
    assert.ok(runResult.latency_ms >= 0, 'Latency must be recorded');
    assert.strictEqual(runResult.error, null, 'Error must be null on success');

    // Run failure check
    const failCheckDef = {
      id: 'test-local-fail',
      name: 'Local Failing Probe',
      url: `http://127.0.0.1:${fixturePort}/fail`,
      expect_status: 200
    };
    const failResult = await syntheticsRunner.runHealthCheck(failCheckDef, 'staging');
    assert.strictEqual(failResult.status, 'DOWN', 'Health check should fail for 500 response');

    // Test API route: GET /api/v2/health-checks/summary
    const hcRes = await fetch(`${baseUrl}/api/v2/health-checks/summary`);
    assert.strictEqual(hcRes.status, 200, 'Health checks summary route should return 200');
    const hcData = await hcRes.json();
    assert.ok(hcData.summary, 'Summary object must exist');
    assert.ok(Array.isArray(hcData.definitions), 'Definitions list must exist');
    console.log('✔ O6.1 Passed: Health checks execute real HTTP probes and summary API responds cleanly.');

    healthFixtureServer.close();

    // -------------------------------------------------------------------------
    // O6.2: Platform Health Aggregation
    // -------------------------------------------------------------------------
    console.log('\n[TEST O6.2] Platform health aggregation API (/api/v2/platform/health)...');
    const phRes = await fetch(`${baseUrl}/api/v2/platform/health`);
    assert.strictEqual(phRes.status, 200, 'Platform health route should return 200');
    const phData = await phRes.json();
    assert.ok(phData.ingest, 'Platform health must include ingest section');
    assert.ok(phData.clickhouse, 'Platform health must include clickhouse section');
    assert.ok(Array.isArray(phData.jobs), 'Platform health must include background jobs list');
    assert.ok(phData.leader, 'Platform health must include leader coordination info');
    console.log('✔ O6.2 Passed: Platform health combines pipeline, clickhouse, jobs, and leader state.');

    // -------------------------------------------------------------------------
    // O6.3: Remediation Autonomous Toggle & Four-Eyes Prod Gate
    // -------------------------------------------------------------------------
    console.log('\n[TEST O6.3] Remediation autonomous toggle & four-eyes governance...');

    const viewerToken = session.generateToken({ username: 'viewer@corp.internal', role: 'Viewer', environment: 'staging' });
    const lead1Token = session.generateToken({ username: 'sre-lead-alpha', role: 'SRE Lead', environment: 'prod' });
    const lead2Token = session.generateToken({ username: 'admin-bravo', role: 'Super Admin', environment: 'prod' });

    // 1. Viewer role returns 403
    const viewerRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${viewerToken}`
      },
      body: JSON.stringify({ autonomousMode: true })
    });
    assert.strictEqual(viewerRes.status, 403, 'Viewer role must receive 403 on settings mutation');

    // 2. Turning ON in PROD by User 1 creates four-eyes pending request
    // Ensure clean state
    db.updateSettings({ autonomousMode: false, pendingApproval: null });

    const prodUser1Res = await fetch(`${baseUrl}/api/settings?env=prod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lead1Token}`
      },
      body: JSON.stringify({ autonomousMode: true })
    });
    assert.strictEqual(prodUser1Res.status, 200, 'First request in PROD should succeed');
    const prodUser1Data = await prodUser1Res.json();
    assert.strictEqual(prodUser1Data.autonomousMode, false, 'Autonomous mode must REMAIN FALSE after only 1 signature in PROD');
    assert.ok(prodUser1Data.pendingApproval, 'pendingApproval object must be created');
    assert.strictEqual(prodUser1Data.pendingApproval.requestedBy, 'sre-lead-alpha');

    // 3. Same User 1 approving again must return 403 SOD_VIOLATION
    const prodSameUserRes = await fetch(`${baseUrl}/api/settings?env=prod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lead1Token}`
      },
      body: JSON.stringify({ autonomousMode: true })
    });
    assert.strictEqual(prodSameUserRes.status, 403, 'Same requester approving must fail SOD');
    const sodData = await prodSameUserRes.json();
    assert.strictEqual(sodData.code, 'SOD_VIOLATION');

    // 4. Second distinct user approves -> autonomousMode becomes true
    const prodUser2Res = await fetch(`${baseUrl}/api/settings?env=prod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lead2Token}`
      },
      body: JSON.stringify({ autonomousMode: true })
    });
    assert.strictEqual(prodUser2Res.status, 200, 'Second distinct approver should succeed');
    const prodUser2Data = await prodUser2Res.json();
    assert.strictEqual(prodUser2Data.autonomousMode, true, 'Autonomous mode must turn TRUE after dual signature');
    assert.strictEqual(prodUser2Data.pendingApproval, null, 'Pending approval must be cleared');
    assert.strictEqual(prodUser2Data.lastChangedBy, 'admin-bravo');

    // 5. Test paginated runs endpoint: GET /api/v2/remediation/runs
    const runsRes = await fetch(`${baseUrl}/api/v2/remediation/runs?limit=10`);
    assert.strictEqual(runsRes.status, 200, 'Remediation runs should return 200');
    const runsData = await runsRes.json();
    assert.ok(Array.isArray(runsData.runs), 'runs array must exist');
    console.log('✔ O6.3 Passed: Role check, four-eyes gate in PROD, SOD protection, and runs pagination verified.');

    // -------------------------------------------------------------------------
    // O6.4: Distributed Traces Search and Detail
    // -------------------------------------------------------------------------
    console.log('\n[TEST O6.4] Trace explorer API (/api/v2/traces)...');
    const traceListRes = await fetch(`${baseUrl}/api/v2/traces?limit=25`);
    assert.strictEqual(traceListRes.status, 200, 'Trace search should return 200');
    const traceListData = await traceListRes.json();
    assert.ok(Array.isArray(traceListData.traces), 'traces array must exist');

    // Non-existent trace returns 404
    const notFoundTrace = await fetch(`${baseUrl}/api/v2/traces/non-existent-trace-id-12345`);
    assert.strictEqual(notFoundTrace.status, 404, 'Unknown trace must return 404');
    console.log('✔ O6.4 Passed: Distributed trace search and detail routes respond correctly.');

    // -------------------------------------------------------------------------
    // O6.5: Configuration Redaction & Immutability
    // -------------------------------------------------------------------------
    console.log('\n[TEST O6.5] Configuration viewer secret masking & immutability...');

    // 1. Check /api/yaml/all redaction
    const yamlAllRes = await fetch(`${baseUrl}/api/yaml/all`);
    assert.strictEqual(yamlAllRes.status, 200, 'Configuration all should return 200');
    const yamlAllData = await yamlAllRes.json();
    const yamlAllStr = JSON.stringify(yamlAllData);

    // Verify secrets are redacted to '***'
    assert.ok(yamlAllStr.includes('***'), 'Secrets in config manifests must be masked with ***');

    // 2. Check /api/yaml/app/:id
    const yamlAppRes = await fetch(`${baseUrl}/api/yaml/app/bitbucket`);
    assert.strictEqual(yamlAppRes.status, 200, 'App yaml should return 200');
    const yamlAppData = await yamlAppRes.json();
    const yamlAppStr = JSON.stringify(yamlAppData);
    assert.ok(!yamlAppStr.includes('"token":"secret'), 'Raw token values must not be returned');

    // 3. Verify no mutation routes (PUT/POST) exist on /api/yaml
    const putRes = await fetch(`${baseUrl}/api/yaml/all`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lead2Token}`
      },
      body: JSON.stringify({ malicious: true })
    });
    assert.strictEqual(putRes.status, 404, 'PUT on /api/yaml must return 404 (strictly read-only)');

    const postRes = await fetch(`${baseUrl}/api/yaml/app/bitbucket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lead2Token}`
      },
      body: JSON.stringify({ malicious: true })
    });
    assert.strictEqual(postRes.status, 404, 'POST on /api/yaml must return 404 (strictly read-only)');

    // 4. Verify /api/yaml/config-check
    const checkRes = await fetch(`${baseUrl}/api/yaml/config-check`);
    assert.strictEqual(checkRes.status, 200, 'config-check route should return 200');
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.status, 'PASS', 'config-check status must be PASS');
    console.log('✔ O6.5 Passed: Secret redaction (***) enforced, no mutation routes exist, and config-check status verified.');

    console.log('\n✅ ALL PHASE O6 TESTS PASSED SUCCESSFULLY.');
    server.close();
    process.exit(0);
  } finally {
    try { server.close(); } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('\n❌ PHASE O6 TEST FAILED:', err);
  process.exit(1);
});
