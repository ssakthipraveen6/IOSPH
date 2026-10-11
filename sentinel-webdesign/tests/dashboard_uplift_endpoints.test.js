const assert = require('assert');
const { app } = require('../backend/server');
const http = require('http');

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const opts = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(opts, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          server.close();
          try {
            const data = JSON.parse(raw);
            resolve({ status: res.statusCode, data });
          } catch (_) {
            resolve({ status: res.statusCode, raw });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

async function runDashboardTests() {
  console.log('======================================================');
  console.log('🧪 RUNNING DASHBOARD UPLIFT ENDPOINTS REGRESSION SUITE');
  console.log('======================================================');

  // Test 1: GET /api/slo/status
  console.log('\n--- Test 1: GET /api/slo/status ---');
  const sloRes = await makeRequest('/api/slo/status?env=staging');
  assert.strictEqual(sloRes.status, 200, 'SLO status must return HTTP 200');
  assert.ok(sloRes.data && Array.isArray(sloRes.data.slos), 'Must return slos array');
  assert.strictEqual(sloRes.data.slos.length, 3, 'Must contain 3 SLOs');
  console.log(`✔ Test 1 Passed: /api/slo/status returned ${sloRes.data.slos.length} evaluated SLOs.`);

  // Test 2: GET /api/anomalies
  console.log('\n--- Test 2: GET /api/anomalies ---');
  const anomRes = await makeRequest('/api/anomalies?env=staging&limit=10');
  assert.strictEqual(anomRes.status, 200, 'Anomalies must return HTTP 200');
  assert.ok(anomRes.data && Array.isArray(anomRes.data.anomalies), 'Must return anomalies array');
  console.log(`✔ Test 2 Passed: /api/anomalies returned ${anomRes.data.anomalies.length} anomaly records.`);

  // Test 3: GET /api/itsm/tickets
  console.log('\n--- Test 3: GET /api/itsm/tickets ---');
  const itsmRes = await makeRequest('/api/itsm/tickets?env=staging');
  assert.strictEqual(itsmRes.status, 200, 'ITSM tickets must return HTTP 200');
  assert.ok(itsmRes.data && Array.isArray(itsmRes.data.tickets), 'Must return tickets array');
  console.log(`✔ Test 3 Passed: /api/itsm/tickets returned ${itsmRes.data.tickets.length} tickets.`);

  // Test 4: GET /api/traces/:traceId
  console.log('\n--- Test 4: GET /api/traces/:traceId ---');
  const traceRes = await makeRequest('/api/traces/00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  assert.strictEqual(traceRes.status, 200, 'Trace explorer must return HTTP 200');
  assert.ok(traceRes.data && Array.isArray(traceRes.data.spans), 'Must return waterfall spans');
  assert.strictEqual(traceRes.data.spans.length, 5, 'Must contain 5 pipeline waterfall spans');
  console.log(`✔ Test 4 Passed: /api/traces/:traceId returned 5 waterfall spans.`);

  // Test 5: GET /api/circuit-breaker/status
  console.log('\n--- Test 5: GET /api/circuit-breaker/status ---');
  const cbRes = await makeRequest('/api/circuit-breaker/status');
  assert.strictEqual(cbRes.status, 200, 'Circuit breaker status must return HTTP 200');
  assert.ok(cbRes.data && cbRes.data.state, 'Must return circuit breaker state');
  console.log(`✔ Test 5 Passed: /api/circuit-breaker/status returned state: ${cbRes.data.state}.`);

  console.log('\n======================================================');
  console.log('🎉 ALL DASHBOARD UPLIFT TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

if (require.main === module) {
  runDashboardTests()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
}

module.exports = { runDashboardTests };
