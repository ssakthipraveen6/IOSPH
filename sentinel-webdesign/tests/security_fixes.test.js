// Regression test suite for Sentinel security fixes (SF-08 to SF-18)
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const db = require('../database/db');
const session = require('../backend/auth/session');
const { app, server } = require('../backend/server');

// Helper to send HTTP requests to test server
function httpRequest({ port, method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Executes security fixes regression tests
async function runTests() {
  console.log('=== RUNNING SECURITY FIXES REGRESSION TEST SUITE ===');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // --- SF-08: Client cannot skip approval on POST /api/recovery/trigger ---
    console.log('--- SF-08: POST /api/recovery/trigger cannot bypass four-eyes approval ---');
    db.updateSettings({ autonomousMode: false, pendingApproval: null });
    const operatorToken = session.generateToken({ username: 'op.dummy', role: 'Operator', environment: 'staging' });
    const triggerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/recovery/trigger',
      headers: {
        'Authorization': `Bearer ${operatorToken}`
      },
      body: {
        component: 'database',
        options: { manual: true }
      }
    });
    assert.strictEqual(triggerRes.status, 200, `Expected 200 for trigger, got ${triggerRes.status}`);
    const run = triggerRes.body.run;
    assert.ok(run, 'Run object must be returned');
    assert.strictEqual(run.status, 'Awaiting-Approval', `Expected Awaiting-Approval but got ${run.status}`);
    console.log('✔ SF-08 Passed: manual:true option ignored; status is Awaiting-Approval');

    // --- SF-09: Allowlist the generic settings update ---
    console.log('--- SF-09: Generic settings update allowlist ---');
    const sreToken = session.generateToken({ username: 'sre.lead', role: 'SRE Lead', environment: 'staging' });
    const fakePending = { pendingApproval: { requestedBy: 'ghost', signatures: ['ghost'] } };
    const initialPending = db.getSettings().pendingApproval;

    const forgeRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/settings',
      headers: { 'Authorization': `Bearer ${sreToken}` },
      body: fakePending
    });
    assert.strictEqual(forgeRes.status, 400, `Expected 400 when posting unauthorized settings, got ${forgeRes.status}`);
    assert.deepStrictEqual(db.getSettings().pendingApproval, initialPending, 'pendingApproval must remain unchanged');

    // Then POST {autonomousMode:true} with ?env=prod and assert autonomousMode is still false
    const autoProdRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/settings?env=prod',
      headers: { 'Authorization': `Bearer ${sreToken}` },
      body: { autonomousMode: true }
    });
    assert.strictEqual(autoProdRes.status, 200, `Expected 200, got ${autoProdRes.status}`);
    assert.strictEqual(db.getSettings().autonomousMode, false, 'autonomousMode must remain false after single signer in prod');
    console.log('✔ SF-09 Passed: Unallowlisted settings update rejected with 400; pendingApproval not forged');

    // --- SF-10: Dual approval whenever autonomous mode is switched on ---
    console.log('--- SF-10: Dual approval required for autonomousMode regardless of env ---');
    db.updateSettings({ autonomousMode: false, pendingApproval: null });
    const leadToken = session.generateToken({ username: 'lead.test', role: 'SRE Lead', environment: 'staging' });

    const stagingAutoRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/settings?environment=staging',
      headers: { 'Authorization': `Bearer ${leadToken}` },
      body: { autonomousMode: true }
    });
    assert.strictEqual(stagingAutoRes.status, 200);
    assert.strictEqual(stagingAutoRes.body.autonomousMode, false, 'Must not enable autonomousMode with 1 signer in staging');
    assert.ok(stagingAutoRes.body.pendingApproval, 'pendingApproval must be created in staging');
    console.log('✔ SF-10 Passed: Single signer in staging results in pendingApproval and autonomousMode:false');

    // --- SF-13: Evidence pack bound to the caller's environment ---
    console.log('--- SF-13: Evidence pack bound to caller environment ---');
    const problemStore = require('../correlation/problem_store');
    problemStore.setPool(null);
    await problemStore.save({
      id: 'PRB-test0001',
      environment: 'prod',
      title: 'dummy'
    });

    const superAdminProdToken = session.generateToken({ username: 'admin.super', role: 'Super Admin', environment: 'prod' });
    const superAdminStgToken = session.generateToken({ username: 'admin.super', role: 'Super Admin', environment: 'staging' });

    // Staging caller should get 404
    const stgRes = await httpRequest({
      port,
      method: 'GET',
      path: '/api/problems/PRB-test0001/evidence?environment=staging',
      headers: { 'Authorization': `Bearer ${superAdminStgToken}` }
    });
    assert.strictEqual(stgRes.status, 404, `Expected 404 when querying prod problem from staging, got ${stgRes.status}`);

    // Prod caller should get 200
    const prodRes = await httpRequest({
      port,
      method: 'GET',
      path: '/api/problems/PRB-test0001/evidence?environment=prod',
      headers: { 'Authorization': `Bearer ${superAdminProdToken}` }
    });
    assert.strictEqual(prodRes.status, 200, `Expected 200 when querying prod problem from prod, got ${prodRes.status}`);
    console.log('✔ SF-13 Passed: Cross-environment evidence pack access blocked with 404');

    // --- SF-14: Session lifetime cap, refresh revocation, logout ---
    console.log('--- SF-14: Session lifetime cap, refresh revocation, and logout ---');
    // 14a: Max session ms expiry
    process.env.SENTINEL_MAX_SESSION_MS = '1000';
    try {
      const expiredToken = session.generateToken({
        username: 'time.user',
        role: 'Operator',
        environment: 'staging',
        auth_time: Date.now() - 2000
      });
      assert.strictEqual(session.verifyToken(expiredToken), null, 'Token exceeding max session lifetime must fail verifyToken');
      console.log('✔ SF-14a Passed: Token past max session lifetime is rejected');
    } finally {
      delete process.env.SENTINEL_MAX_SESSION_MS;
    }

    // 14b: Environment switch revokes old token
    const envSwitchUserToken = session.generateToken({ username: 'switch.user', role: 'Super Admin', environment: 'staging' });
    const envSwitchRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/environment',
      headers: {
        'Authorization': `Bearer ${envSwitchUserToken}`,
        'Content-Type': 'application/json'
      },
      body: { environment: 'prod' }
    });
    assert.strictEqual(envSwitchRes.status, 200, `Expected 200 from environment switch, got ${envSwitchRes.status}`);
    assert.strictEqual(session.verifyToken(envSwitchUserToken), null, 'Old token must be revoked after environment switch');
    console.log('✔ SF-14b Passed: Old token revoked after environment switch');

    // 14c: Logout revokes token
    const logoutUserToken = session.generateToken({ username: 'logout.user', role: 'Operator', environment: 'staging' });
    const logoutRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/auth/logout',
      headers: {
        'Authorization': `Bearer ${logoutUserToken}`
      }
    });
    assert.strictEqual(logoutRes.status, 200, `Expected 200 from logout, got ${logoutRes.status}`);
    assert.strictEqual(session.verifyToken(logoutUserToken), null, 'Token must be revoked after logout');
    console.log('✔ SF-14c Passed: Token revoked after logout');

    // --- SF-15: WebSocket log lines only to matching environment ---
    console.log('--- SF-15: WebSocket log lines environment segregation ---');
    const wsStgToken = session.generateToken({ username: 'ws.admin', role: 'Super Admin', environment: 'staging' });
    const wsProdToken = session.generateToken({ username: 'ws.admin', role: 'Super Admin', environment: 'prod' });

    const wsStg = new WebSocket(`ws://127.0.0.1:${port}/ws?environment=staging&token=${wsStgToken}`);
    const wsProd = new WebSocket(`ws://127.0.0.1:${port}/ws?environment=prod&token=${wsProdToken}`);

    await Promise.all([
      new Promise(r => wsStg.on('open', r)),
      new Promise(r => wsProd.on('open', r))
    ]);

    const stgMessages = [];
    const prodMessages = [];
    wsStg.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'log') stgMessages.push(msg);
      } catch (_) {}
    });
    wsProd.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'log') prodMessages.push(msg);
      } catch (_) {}
    });

    // Broadcast a prod log line
    global.broadcastLog({ message: 'X', environment: 'prod' });

    // Wait 200ms for websocket delivery
    await new Promise(r => setTimeout(r, 200));

    wsStg.close();
    wsProd.close();

    assert.strictEqual(stgMessages.length, 0, `Staging ws client must NOT receive prod log (received ${stgMessages.length})`);
    assert.strictEqual(prodMessages.length, 1, `Prod ws client must receive exactly 1 log (received ${prodMessages.length})`);
    assert.strictEqual(prodMessages[0].data.message, 'X');
    console.log('✔ SF-15 Passed: Only prod ws client received prod log');

    // -------------------------------------------------------------------------
    // SF-18: Role gates on unrestricted state-changing routes
    // -------------------------------------------------------------------------
    console.log('--- SF-18: Role gates on unrestricted state-changing routes ---');
    const viewerToken = session.generateToken({ username: 'viewer.sf18', role: 'Viewer', environment: 'staging' });
    const sreLeadToken = session.generateToken({ username: 'lead.sf18', role: 'SRE Lead', environment: 'staging' });

    // 1. POST /api/v2/health-checks/:id/run
    const hcViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/health-checks/hc-dummy/run',
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert.strictEqual(hcViewerRes.status, 403, 'Viewer should receive 403 on health check run');

    const hcLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/health-checks/nonexistent/run',
      headers: { Authorization: `Bearer ${sreLeadToken}` }
    });
    assert.notStrictEqual(hcLeadRes.status, 403, 'SRE Lead should pass role gate on health check run');

    // 2. POST /api/v2/health-checks/run-all
    const hcAllViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/health-checks/run-all',
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert.strictEqual(hcAllViewerRes.status, 403, 'Viewer should receive 403 on health checks run-all');

    const hcAllLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/health-checks/run-all',
      headers: { Authorization: `Bearer ${sreLeadToken}` }
    });
    assert.notStrictEqual(hcAllLeadRes.status, 403, 'SRE Lead should pass role gate on health checks run-all');

    // 3. POST /api/v2/infra/hosts/:host/processes/:pid/dump
    const dumpViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/infra/hosts/host-01/processes/123/dump',
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert.strictEqual(dumpViewerRes.status, 403, 'Viewer should receive 403 on infra dump');

    const dumpLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/infra/hosts/host-01/processes/123/dump',
      headers: { Authorization: `Bearer ${sreLeadToken}` }
    });
    assert.notStrictEqual(dumpLeadRes.status, 403, 'SRE Lead should pass role gate on infra dump');

    // 4. POST /api/v2/events
    const evViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/events',
      headers: { Authorization: `Bearer ${viewerToken}` },
      body: { kind: 'deployment', entity_id: 'svc-1' }
    });
    assert.strictEqual(evViewerRes.status, 403, 'Viewer should receive 403 on POST /api/v2/events');

    const evLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/events',
      headers: { Authorization: `Bearer ${sreLeadToken}` },
      body: { kind: 'deployment', entity_id: 'svc-1', environment: 'tampered-env' }
    });
    assert.notStrictEqual(evLeadRes.status, 403, 'SRE Lead should pass role gate on POST /api/v2/events');
    if (evLeadRes.status === 201) {
      assert.strictEqual(evLeadRes.body.environment, 'staging', 'Environment must be forced to caller environment (staging)');
    }

    // 5. POST /api/v2/correlation/trigger
    const corrViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/correlation/trigger',
      headers: { Authorization: `Bearer ${viewerToken}` },
      body: { entity_id: 'svc-1' }
    });
    assert.strictEqual(corrViewerRes.status, 403, 'Viewer should receive 403 on correlation trigger');

    const corrLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/correlation/trigger',
      headers: { Authorization: `Bearer ${sreLeadToken}` },
      body: { entity_id: 'svc-1' }
    });
    assert.notStrictEqual(corrLeadRes.status, 403, 'SRE Lead should pass role gate on correlation trigger');

    // 6. POST /api/v2/rca/hypotheses/:id/verdict
    const rcaViewerRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/rca/hypotheses/hypo-1/verdict',
      headers: { Authorization: `Bearer ${viewerToken}` },
      body: { verdict: 'confirmed' }
    });
    assert.strictEqual(rcaViewerRes.status, 403, 'Viewer should receive 403 on RCA hypothesis verdict');

    const rcaLeadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/v2/rca/hypotheses/hypo-1/verdict',
      headers: { Authorization: `Bearer ${sreLeadToken}` },
      body: { verdict: 'confirmed' }
    });
    assert.notStrictEqual(rcaLeadRes.status, 403, 'SRE Lead should pass role gate on RCA hypothesis verdict');
    console.log('✔ SF-18 Passed: Viewer gets 403 and SRE Lead is permitted across all state-changing routes');

  } finally {
    server.close();
  }

  console.log('=== ALL SECURITY FIXES TESTS IN SUITE PASSED ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
