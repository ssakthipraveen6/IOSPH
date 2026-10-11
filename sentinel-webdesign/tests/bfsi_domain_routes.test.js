const assert = require('assert');
const http = require('http');

// Import app from server.js
const { app } = require('../backend/server');

console.log('=== RUNNING BFSI TIER-0 DOMAIN ROUTE TESTS ===');

let server;
const PORT = 3099;

function requestGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
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

(async () => {
  server = app.listen(PORT, '127.0.0.1', async () => {
    try {
      // 1. APM Overview
      const apmRes = await requestGet('/api/apm/overview');
      assert.strictEqual(apmRes.status, 200, 'GET /api/apm/overview should return 200');
      assert.strictEqual(typeof apmRes.body.apdex, 'number');
      assert.strictEqual(Array.isArray(apmRes.body.deployments), true);
      console.log('✔ Test 1 Passed: /api/apm/overview returns Apdex & deployment history');

      // 2. K8s Mesh
      const k8sRes = await requestGet('/api/k8s/mesh');
      assert.strictEqual(k8sRes.status, 200, 'GET /api/k8s/mesh should return 200');
      assert.strictEqual(typeof k8sRes.body.coresAllocated, 'number');
      assert.strictEqual(Array.isArray(k8sRes.body.nodes), true);
      console.log('✔ Test 2 Passed: /api/k8s/mesh returns compute cores & node honeycomb');

      // 3. Perimeter Telemetry
      const perimRes = await requestGet('/api/perimeter/telemetry');
      assert.strictEqual(perimRes.status, 200, 'GET /api/perimeter/telemetry should return 200');
      assert.strictEqual(typeof perimRes.body.bandwidthGb, 'number');
      assert.strictEqual(Array.isArray(perimRes.body.liveStream), true);
      console.log('✔ Test 3 Passed: /api/perimeter/telemetry returns edge bandwidth & live log stream');

      // 4. Governance & SoD Audit
      const govRes = await requestGet('/api/governance/sod-audit');
      assert.strictEqual(govRes.status, 200, 'GET /api/governance/sod-audit should return 200');
      assert.strictEqual(Array.isArray(govRes.body.pendingActions), true);
      assert.strictEqual(Array.isArray(govRes.body.auditTrail), true);
      console.log('✔ Test 4 Passed: /api/governance/sod-audit returns SoD actions & WAL audit trail');

      console.log('=== ALL BFSI DOMAIN ROUTE TESTS PASSED ===');
      server.close(() => process.exit(0));
    } catch (err) {
      console.error('✘ Test Failed:', err.message);
      server.close(() => process.exit(1));
    }
  });
})();
