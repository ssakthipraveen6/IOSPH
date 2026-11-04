// Regression test suite for Sentinel security fixes (SF-08 to SF-18)
const assert = require('assert');
const http = require('http');
const db = require('../database/db');
const session = require('../backend/auth/session');
const { app } = require('../backend/server');

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
  const server = http.createServer(app);
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
