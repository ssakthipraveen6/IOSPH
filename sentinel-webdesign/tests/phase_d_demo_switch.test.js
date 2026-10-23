/**
 * Test: demo view and the PRD/STG switch.
 */
const assert = require('assert');
const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const { app } = require('../backend/server');

console.log('=== RUNNING PHASE D (DEMO VIEW & PROD/STAG SWITCH) ACCEPTANCE TESTS ===');

let server;

function request(port, options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    // 1. Normal routes explicitly reject environment=demo with HTTP 400
    const alertsDemo = await request(port, { path: '/api/alerts?environment=demo' });
    assert.strictEqual(alertsDemo.status, 400, 'GET /api/alerts?environment=demo must return 400');
    assert.strictEqual(alertsDemo.body.error, 'Use the Demo view (/api/demo)');

    const envDemoQuery = await request(port, { path: '/api/environment?environment=demo' });
    assert.strictEqual(envDemoQuery.status, 400, 'GET /api/environment?environment=demo must return 400');
    assert.strictEqual(envDemoQuery.body.error, 'Use the Demo view (/api/demo)');

    const envPostDemo = await request(port, {
      path: '/api/environment',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { environment: 'demo' });
    assert.strictEqual(envPostDemo.status, 400, 'POST /api/environment with demo must return 400');
    assert.strictEqual(envPostDemo.body.error, 'Use the Demo view (/api/demo)');

    console.log('✔ Test 1 Passed: Normal routes return HTTP 400 ("Use the Demo view (/api/demo)") on demo env');

    // 2. Normal environment API only exposes prod and staging (never demo)
    const envGet = await request(port, { path: '/api/environment' });
    assert.strictEqual(envGet.status, 200);
    assert.deepStrictEqual(envGet.body.allowed, ['prod', 'staging']);
    assert.ok(['prod', 'staging'].includes(envGet.body.environment));
    console.log('✔ Test 2 Passed: /api/environment strictly allows only prod and staging');

    // 3. GET /api/demo/* returns 200 with { demo: true, generated_at, data } for all 12 areas
    const demoEndpoints = [
      '/api/demo/home',
      '/api/demo/problems',
      '/api/demo/alerts',
      '/api/demo/products',
      '/api/demo/avi',
      '/api/demo/databases',
      '/api/demo/kubernetes',
      '/api/demo/hosts',
      '/api/demo/topology',
      '/api/demo/evidence/PRB-SAMPLE-01',
      '/api/demo/dashboards',
      '/api/demo/correlation'
    ];

    for (const ep of demoEndpoints) {
      const res = await request(port, { path: ep });
      assert.strictEqual(res.status, 200, `${ep} must return HTTP 200`);
      assert.strictEqual(res.body.demo, true, `${ep} must have demo: true`);
      assert.ok(typeof res.body.generated_at === 'string', `${ep} must have generated_at string`);
      assert.ok(res.body.data !== undefined && res.body.data !== null, `${ep} must have data payload`);
    }
    console.log('✔ Test 3 Passed: All 12 /api/demo/* endpoints return 200 with standard demo envelope');

    // 4. Non-GET methods on /api/demo/* are rejected with HTTP 405 Method Not Allowed
    const postDemo = await request(port, { path: '/api/demo/home', method: 'POST' });
    assert.strictEqual(postDemo.status, 405, 'POST /api/demo/home must return 405');
    assert.strictEqual(postDemo.headers['allow'], 'GET, HEAD');

    const deleteDemo = await request(port, { path: '/api/demo/alerts', method: 'DELETE' });
    assert.strictEqual(deleteDemo.status, 405, 'DELETE /api/demo/alerts must return 405');

    console.log('✔ Test 4 Passed: Non-GET requests on /api/demo/* return HTTP 405 with Allow header');

    // 5. Run lint:demo script and assert zero violations
    const lintOutput = execSync(`node ${path.resolve(__dirname, '../scripts/lint_no_demo.js')}`, { encoding: 'utf8' });
    assert.ok(lintOutput.includes('[lint:demo] PASSED'), 'lint:demo must pass cleanly');
    console.log('✔ Test 5 Passed: lint:demo reports clean across all production codebase');

    console.log('=== ALL PHASE D ACCEPTANCE TESTS PASSED ===');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('✘ Test Failed:', err.message);
    server.close(() => process.exit(1));
  }
});
