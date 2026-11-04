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
    db.updateSettings({ autonomousMode: false });
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
