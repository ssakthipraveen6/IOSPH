const http = require('http');
const session = require('../backend/auth/session');
const adminToken = session.generateToken({ username: 'admin_operator@enterprise.corp', role: 'Super Admin' });

const ENDPOINTS = [
  { path: '/healthz', method: 'GET', expectedStatus: 200, name: 'Liveness Probe' },
  { path: '/readyz', method: 'GET', expectedStatus: 200, name: 'Readiness Probe' },
  { path: '/api/health', method: 'GET', expectedStatus: 200, name: 'Health Overview State' },
  { path: '/api/environment', method: 'GET', expectedStatus: 200, name: 'Current Environment' },
  { path: '/api/metrics', method: 'GET', expectedStatus: 200, name: 'All Metrics' },
  { path: '/api/metrics/database', method: 'GET', expectedStatus: 200, name: 'Database Component Metric' },
  { path: '/api/alerts', method: 'GET', expectedStatus: 200, name: 'Active Alerts' },
  { path: '/api/recovery', method: 'GET', expectedStatus: 200, name: 'Autonomous Recovery Logs' },
  { path: '/api/yaml/all', method: 'GET', expectedStatus: 200, name: 'YAML Topologies Registry' },
  { path: '/api/yaml/raw?appId=jenkins', method: 'GET', expectedStatus: 200, name: 'Jenkins Raw YAML Manifest' },
  { path: '/api/auth/sso/status', method: 'GET', expectedStatus: 200, name: 'eLDAP / SSO Status' },
  { path: '/api/admin/audit-logs', method: 'GET', expectedStatus: 200, name: 'Audit Logs (with Super Admin Bearer Token)', auth: true },
  { path: '/api/rca-correlation?app=jenkins', method: 'GET', expectedStatus: 200, name: 'RCA Correlation Engine' },
  { path: '/api/infra-tickets', method: 'GET', expectedStatus: 200, name: 'Infra Tickets' },
  { path: '/api/servicenow/active-incidents', method: 'GET', expectedStatus: 200, name: 'ServiceNow Incidents' },
  { path: '/api/misc/rota', method: 'GET', expectedStatus: 200, name: 'Monthly Rota Schedules' },
  { path: '/api/misc/dynatrace-problems', method: 'GET', expectedStatus: 200, name: 'Dynatrace Active Problems' },
  { path: '/api/custom-checks', method: 'GET', expectedStatus: 200, name: 'Custom Operational Checks' },
  { path: '/api/pbi/metrics?component=database&metricName=query_latency&hours=24', method: 'GET', expectedStatus: 200, name: 'PowerBI Historical Metrics' },
  { path: '/api/pbi/logs', method: 'GET', expectedStatus: 200, name: 'PowerBI Log Distributions' },
  { path: '/', method: 'GET', expectedStatus: 200, name: 'SPA Frontend Root Index' },
  { path: '/api/invalid_test_route_404', method: 'GET', expectedStatus: 404, name: 'Strict JSON 404 Guard' }
];

async function testEndpoint(endpoint) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3001,
      path: endpoint.path,
      method: endpoint.method,
      headers: {
        'Accept': 'application/json, text/html',
        ...(endpoint.auth ? { 'Authorization': `Bearer ${adminToken}` } : {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const pass = res.statusCode === endpoint.expectedStatus;
        let isJson = false;
        try {
          JSON.parse(body);
          isJson = true;
        } catch (e) {}

        if (endpoint.path === '/api/invalid_test_route_404') {
          // Verify 404 returned JSON error, not HTML!
          if (!isJson) {
            return resolve({
              name: endpoint.name,
              pass: false,
              detail: `Expected JSON 404, received non-JSON (likely HTML fallback): ${body.substring(0, 80)}`
            });
          }
        }

        if (endpoint.path === '/') {
          // Verify HTML contains Sentinel root
          if (!body.includes('id="root"')) {
            return resolve({
              name: endpoint.name,
              pass: false,
              detail: `Root HTML missing #root element`
            });
          }
        }

        resolve({
          name: endpoint.name,
          pass,
          statusCode: res.statusCode,
          detail: pass ? `HTTP ${res.statusCode} (${isJson ? 'JSON' : 'HTML'}, ${body.length} bytes)` : `Expected HTTP ${endpoint.expectedStatus}, got ${res.statusCode}`
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        name: endpoint.name,
        pass: false,
        detail: `Network error: ${e.message}`
      });
    });

    req.end();
  });
}

async function runAll() {
  console.log('====================================================');
  console.log('🚀 TESTING ALL LIVE REST & SPA ENDPOINTS ON :3001');
  console.log('====================================================');

  let passed = 0;
  for (const ep of ENDPOINTS) {
    const res = await testEndpoint(ep);
    if (res.pass) {
      console.log(`✔ [PASS] ${res.name.padEnd(35)} -> ${res.detail}`);
      passed++;
    } else {
      console.log(`❌ [FAIL] ${res.name.padEnd(35)} -> ${res.detail}`);
    }
  }

  console.log('====================================================');
  console.log(`TOTAL RESULT: ${passed} / ${ENDPOINTS.length} PASSED`);
  console.log('====================================================');

  if (passed === ENDPOINTS.length) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAll();
