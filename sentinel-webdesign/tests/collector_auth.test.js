/**
 * tests/collector_auth.test.js
 *
 * Automated verification of Collector Authentication & AUTH_FAILED Isolation (Phase 1b).
 * Verifies:
 *  1. Bearer token injection from CyberArk credential provider
 *  2. Basic token injection (with and without username)
 *  3. SAML / 302-to-IdP redirect detection and isolation
 *  4. 401 Unauthorized retry logic after cache invalidation
 *  5. Three-way state segregation: HEALTHY vs DATA_UNAVAILABLE vs AUTH_FAILED
 */

const assert = require('assert');
const http = require('http');
const {
  applyAuthentication,
  isAuthFailure,
  fetchJsonWithFallback
} = require('../metrics_collection/shared/fetch_with_fallback');
const credentialProvider = require('../backend/config/cyberark/credential_provider');
const { calculateComponentStatuses } = require('../backend/services/health/healthCalculator');
const { SEVERITY } = require('@sentinel/shared-constants');

async function runTests() {
  console.log('=== RUNNING COLLECTOR AUTHENTICATION & AUTH_FAILED TESTS (Phase 1b) ===');

  // Test 1: Bearer token injection
  process.env.TESTAPP_API_TOKEN = 'cyberark-secret-token-12345';
  const bearerOptions = await applyAuthentication(
    'https://test.internal.corp/api',
    { headers: {} },
    { scheme: 'bearer_token', credential_purpose: 'api_token' },
    'testapp'
  );
  assert.strictEqual(bearerOptions.headers['Authorization'], 'Bearer cyberark-secret-token-12345');
  console.log('✔ Test 1 Passed: Bearer token accurately injected from CyberArk provider');

  // Test 2: Basic token injection
  process.env.JENKINS_TEST_API_TOKEN = 'jenkins-token-abc';
  process.env.JENKINS_TEST_SERVICE_USER = 'svc_jenkins_collector';
  const basicOptions = await applyAuthentication(
    'https://jenkins.internal.corp/job',
    { headers: {} },
    { scheme: 'basic_token', credential_purpose: 'api_token', username_purpose: 'service_user' },
    'jenkins_test'
  );
  const expectedBasic = Buffer.from('svc_jenkins_collector:jenkins-token-abc').toString('base64');
  assert.strictEqual(basicOptions.headers['Authorization'], `Basic ${expectedBasic}`);
  console.log('✔ Test 2 Passed: Basic token with service user accurately injected');

  // Test 3: Basic token with empty password (SonarQube pattern)
  process.env.SONAR_TEST_API_TOKEN = 'sonar-token-xyz';
  const sonarOptions = await applyAuthentication(
    'https://sonar.internal.corp/api',
    { headers: {} },
    { scheme: 'basic_token', credential_purpose: 'api_token', username_purpose: null },
    'sonar_test'
  );
  const expectedSonar = Buffer.from('sonar-token-xyz:').toString('base64');
  assert.strictEqual(sonarOptions.headers['Authorization'], `Basic ${expectedSonar}`);
  console.log('✔ Test 3 Passed: SonarQube token-as-username basic scheme accurately injected');

  // Test 4: Auth failure detector unit check
  assert.strictEqual(isAuthFailure(401), true);
  assert.strictEqual(isAuthFailure(403), true);
  assert.strictEqual(isAuthFailure(302, 'https://idp.enterprise.corp/saml/login'), true);
  assert.strictEqual(isAuthFailure(302, 'https://sso.enterprise.corp/oauth2/authorize'), true);
  assert.strictEqual(isAuthFailure(302, '/api/v1/redirected'), false);
  assert.strictEqual(isAuthFailure(200), false);
  assert.strictEqual(isAuthFailure(500), false);
  console.log('✔ Test 4 Passed: isAuthFailure correctly isolates SSO redirects and 401/403');

  // Test 5: Live server test for 302 IdP redirect -> AUTH_FAILED
  let serverHitCount = 0;
  let lastAuthHeader = null;

  const mockServer = http.createServer((req, res) => {
    serverHitCount++;
    lastAuthHeader = req.headers['authorization'] || null;

    if (req.url === '/302-idp') {
      res.writeHead(302, { Location: 'https://idp.enterprise.corp/saml/login' });
      return res.end();
    }
    if (req.url === '/401-always') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid Token' }));
    }
    if (req.url === '/401-once') {
      if (serverHitCount === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Token Expired' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'OK', recovered: true }));
    }
    if (req.url === '/healthy') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'UP', count: 42 }));
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
  const port = mockServer.address().port;

  try {
    // 5a. Test 302-to-IdP
    const idpRes = await fetchJsonWithFallback(`http://127.0.0.1:${port}/302-idp`);
    assert.strictEqual(idpRes.success, false);
    assert.strictEqual(idpRes.authFailed, true);
    assert.strictEqual(idpRes.status, 'AUTH_FAILED');
    console.log('✔ Test 5a Passed: 302 redirect to IdP isolated to AUTH_FAILED');

    // 5b. Test 401 with retry
    serverHitCount = 0;
    process.env.RETRYAPP_API_TOKEN = 'initial-token';
    const retryRes = await fetchJsonWithFallback(
      `http://127.0.0.1:${port}/401-once`,
      { appId: 'retryapp' }
    );
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(retryRes.data.recovered, true);
    assert.strictEqual(serverHitCount, 2, 'Expected retry to occur after 401');
    console.log('✔ Test 5b Passed: 401 recovered after automatic token retry');

    // 5c. Test persistent 401
    serverHitCount = 0;
    const failed401 = await fetchJsonWithFallback(`http://127.0.0.1:${port}/401-always`, { appId: 'retryapp' });
    assert.strictEqual(failed401.success, false);
    assert.strictEqual(failed401.authFailed, true);
    assert.strictEqual(failed401.status, 'AUTH_FAILED');
    console.log('✔ Test 5c Passed: Persistent 401 isolated to AUTH_FAILED after retry');

    // 5d. Test healthy endpoint
    const healthyRes = await fetchJsonWithFallback(`http://127.0.0.1:${port}/healthy`);
    assert.strictEqual(healthyRes.success, true);
    assert.strictEqual(healthyRes.data.count, 42);
    console.log('✔ Test 5d Passed: Healthy endpoint returned valid telemetry');

    // 5e. Test unreachable host (DATA_UNAVAILABLE, not AUTH_FAILED)
    const deadRes = await fetchJsonWithFallback('http://127.0.0.1:1/unreachable');
    assert.strictEqual(deadRes.success, false);
    assert.strictEqual(deadRes.authFailed, false);
    console.log('✔ Test 5e Passed: Unreachable host is NOT marked as AUTH_FAILED (remains DATA_UNAVAILABLE)');
  } finally {
    mockServer.close();
  }

  // Test 6: Verify healthCalculator segregation of AUTH_FAILED vs DATA_UNAVAILABLE vs HEALTHY
  const fakeDb = {
    getMetrics: (comp) => {
      if (comp === 'auth_fail_app') return [{ metricName: 'status', value: 'AUTH_FAILED' }];
      if (comp === 'dead_app') return [{ metricName: 'error', value: 'Data Not Available' }];
      if (comp === 'live_app') return [{ metricName: 'responseTime', value: 45 }];
      return [];
    }
  };

  const statuses = calculateComponentStatuses({
    components: ['auth_fail_app', 'dead_app', 'live_app'],
    activeAlerts: [],
    sims: {},
    currentEnv: 'staging',
    db: fakeDb
  });

  assert.strictEqual(statuses['auth_fail_app'], SEVERITY.AUTH_FAILED);
  assert.strictEqual(statuses['dead_app'], SEVERITY.DATA_UNAVAILABLE);
  assert.strictEqual(statuses['live_app'], SEVERITY.HEALTHY);
  console.log('✔ Test 6 Passed: Health engine preserves 3 distinct states (AUTH_FAILED, DATA_UNAVAILABLE, HEALTHY)');

  console.log('=== ALL COLLECTOR AUTHENTICATION TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('=== COLLECTOR AUTHENTICATION TESTS FAILED ===', err);
  process.exit(1);
});
