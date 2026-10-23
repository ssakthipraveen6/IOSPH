/**
 * Test: normal routes refuse the demo environment; sample data only under /api/demo.
 */
const assert = require('assert');
const http = require('http');

// Import app from server.js
const { app } = require('../backend/server');

console.log('=== RUNNING BFSI TIER-0 DOMAIN ROUTE TESTS ===');

let server;

function requestGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    // [Phase D / M1.1] Normal routes reject ?environment=demo with 400; sample data isolated under /api/demo/*.
    const apm = await requestGet(port, '/api/apm/overview?environment=demo');
    assert.strictEqual(apm.status, 400);
    assert.ok(apm.body.error.includes('Use the Demo view (/api/demo)'));

    const k8sDemo = await requestGet(port, '/api/demo/kubernetes');
    assert.strictEqual(k8sDemo.status, 200);
    assert.strictEqual(k8sDemo.body.demo, true);
    assert.strictEqual(Array.isArray(k8sDemo.body.data.clusters), true);

    const perimDemo = await requestGet(port, '/api/demo/avi');
    assert.strictEqual(perimDemo.status, 200);
    assert.strictEqual(perimDemo.body.demo, true);
    assert.strictEqual(Array.isArray(perimDemo.body.data.vips), true);
    console.log('✔ Test 1 Passed: normal routes reject demo with 400, sample data isolated under /api/demo/*');

    for (const env of ['prod', 'staging']) {
      for (const path of ['/api/apm/overview', '/api/k8s/mesh', '/api/perimeter/telemetry']) {
        const r = await requestGet(port, `${path}?environment=${env}`);
        assert.strictEqual(r.status, 200, `${path} ${env}`);
        assert.strictEqual(r.body.status, 'DATA_UNAVAILABLE', `${path} must not serve sample data in ${env}`);
        assert.strictEqual(r.body.apdex, undefined);
        assert.strictEqual(r.body.nodes, undefined);
        assert.strictEqual(r.body.liveStream, undefined);
      }
    }
    console.log('✔ Test 2 Passed: prototype views return DATA_UNAVAILABLE in prod and staging');

    // [M1.2] Governance: normal routes reject demo; real pending runs and audit trail outside demo.
    const govDemo = await requestGet(port, '/api/governance/sod-audit?environment=demo');
    assert.strictEqual(govDemo.status, 400);
    assert.ok(govDemo.body.error.includes('Use the Demo view (/api/demo)'));

    const gov = await requestGet(port, '/api/governance/sod-audit?environment=staging');
    assert.strictEqual(gov.status, 200);
    assert.strictEqual(gov.body.prototype, false);
    assert.strictEqual(Array.isArray(gov.body.pendingActions), true);
    assert.strictEqual(Array.isArray(gov.body.auditTrail), true);
    assert.ok(!gov.body.pendingActions.some(a => a.id === 'ACT-0849201'), 'staging must not show the sample action');
    assert.deepStrictEqual(gov.body.itsmSync, []);
    gov.body.pendingActions.forEach(a => {
      assert.ok(['PENDING_FIRST_SIGN', 'PENDING_CO_SIGN'].includes(a.status));
      assert.strictEqual(a.approvalsRequired, 2);
    });
    console.log('✔ Test 3 Passed: governance serves real Awaiting-Approval runs outside demo');

    console.log('=== ALL BFSI DOMAIN ROUTE TESTS PASSED ===');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('✘ Test Failed:', err.message);
    server.close(() => process.exit(1));
  }
});
