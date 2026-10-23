/**
 * Test: sign-in and role lock-down (anonymous writes refused, roles enforced).
 */
const assert = require('assert');
const http = require('http');
const ldapClient = require('../backend/auth/ldap_client');
const session = require('../backend/auth/session');

async function runAuthTests() {
  console.log('=== RUNNING AUTHENTICATION & ROLE LOCKDOWN TESTS (T0.5, T0.6, T0.7, T0.21) ===');

  // Test 1: eLDAP Authentication
  const authRes = await ldapClient.authenticate('admin_user@enterprise.corp', 'secret_pass');
  assert.strictEqual(authRes.success, true);
  assert.strictEqual(authRes.user.role, 'Super Admin');
  console.log('✔ Test 1 Passed: eLDAP authentication succeeded for admin user');

  const invalidAuth = await ldapClient.authenticate('user', 'wrong_password');
  assert.strictEqual(invalidAuth.success, false);
  console.log('✔ Test 2 Passed: eLDAP authentication failed for invalid password');

  // Test 2: Token Generation and Verification with kid and jti (T0.7)
  const token = session.generateToken(authRes.user);
  assert(token.length > 20);

  const verified = session.verifyToken(token);
  assert.strictEqual(verified.username, 'admin_user@enterprise.corp');
  assert.strictEqual(verified.role, 'Super Admin');
  assert.ok(verified.jti, 'Token must contain a unique jti claim');
  console.log('✔ Test 3 Passed: JWT session token generation and verification succeeded with jti:', verified.jti);

  // Test 3: Expired / Corrupted Token Rejection
  const invalidToken = session.verifyToken('invalid.token.signature');
  assert.strictEqual(invalidToken, null);
  console.log('✔ Test 4 Passed: Invalid token signature rejected');

  // Test 4: Token Revocation by jti (T0.7)
  const revoked = session.revokeToken(verified.jti, 'Unit Test Revocation');
  assert.strictEqual(revoked, true);
  const verifiedAfterRevocation = session.verifyToken(token);
  assert.strictEqual(verifiedAfterRevocation, null, 'Revoked token must be rejected');
  console.log('✔ Test 5 Passed: Revoked token was rejected via jti revocation list');

  // Test 5: Key Rotation with two active signing keys (T0.7)
  const prevSecret = 'b'.repeat(64);
  process.env.SENTINEL_JWT_SECRET_PREV = prevSecret;
  process.env.SENTINEL_JWT_KID_PREV = 'k0';

  // Helper to craft a token signed with the previous key
  const crypto = require('crypto');
  function b64Url(s) {
    return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  const prevHeader = { alg: 'HS256', typ: 'JWT', kid: 'k0' };
  const prevPayload = { username: 'rotated_user', role: 'SRE Lead', exp: Date.now() + 60000, jti: 'prev-jti-1' };
  const prevData = `${b64Url(JSON.stringify(prevHeader))}.${b64Url(JSON.stringify(prevPayload))}`;
  const prevSig = crypto.createHmac('sha256', prevSecret).update(prevData).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tokenFromPrevKey = `${prevData}.${prevSig}`;

  const verifiedPrev = session.verifyToken(tokenFromPrevKey);
  assert.ok(verifiedPrev, 'Token signed with previous active key must verify during rotation');
  assert.strictEqual(verifiedPrev.username, 'rotated_user');
  console.log('✔ Test 6 Passed: Token signed with previous key (k0) successfully verified via dual-key rotation');

  // Test 6: Strict CORS Origin Validation (T0.12)
  const { isAllowedOrigin, createCorsOriginCallback } = require('../backend/cors_validator');
  const allowedList = [
    'https://sentinel.yourbank.internal',
    'https://sentinel.internal.corp',
    'https://refweb.internal.corp',
    'https://dashboards.refweb.internal.corp',
    'http://localhost:5173'
  ];

  // Legitimate intranet and explicitly allowed origins
  assert.strictEqual(isAllowedOrigin('https://sentinel.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('https://refweb.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('https://dashboards.refweb.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('http://localhost:5173', allowedList), true);
  assert.strictEqual(isAllowedOrigin(null, allowedList), true); // Server-to-server / CLI

  // Crafted / malicious attacker origins strictly rejected (T0.12)
  assert.strictEqual(isAllowedOrigin('https://notrefweb.attacker.com', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://attacker.com/refweb-phish', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://evilcorp.com', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://evil.corp', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://x.internal', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://internal.hacker.io', allowedList), false);
  assert.strictEqual(isAllowedOrigin('javascript:alert(1)', allowedList), false);

  // Test CORS callback wrapper behavior
  const corsCallback = createCorsOriginCallback(allowedList);
  let accepted = false;
  corsCallback('https://sentinel.internal.corp', (err, allow) => {
    assert.strictEqual(err, null);
    assert.strictEqual(allow, true);
    accepted = true;
  });
  assert.strictEqual(accepted, true);

  let rejected = false;
  corsCallback('https://evil.corp', (err, allow) => {
    assert(err instanceof Error);
    assert(err.message.includes('CORS: Origin'));
    rejected = true;
  });
  assert.strictEqual(rejected, true);
  console.log('✔ Test 7 Passed: CORS origin validation strictly rejects crafted origins including evil.corp');

  // Test 7: HTTP Route RBAC Lockdown (T0.5) & CSRF (T0.21)
  const { app } = require('../backend/server');
  const testServer = http.createServer(app);

  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;

  const makeReq = (options, postData = null) => {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: testPort,
        ...options
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: parsed || body });
        });
      });
      req.on('error', reject);
      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    });
  };

  try {
    // 7a: Anonymous POST /api/settings returns 401 (T0.5)
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // Force strict auth mode
    const anonRes = await makeReq({
      method: 'POST',
      path: '/api/settings',
      headers: { 'Content-Type': 'application/json' }
    }, { autonomousMode: true });
    assert.strictEqual(anonRes.status, 401, `Expected 401 for anonymous POST /api/settings, got ${anonRes.status}`);
    console.log('✔ Test 8 Passed: Anonymous POST /api/settings returned 401 Unauthorized (T0.5)');

    // 7b: NOC Operator token on POST /api/recovery/approve returns 403 (T0.5)
    const db = require('../database/db');
    const testRecovery = db.addRecoveryRun('jenkins_k8s', 'Service Restart', 'Manual test run', 'staging');

    const nocToken = session.generateToken({ username: 'noc_user', role: 'NOC Operator' });
    const nocRes = await makeReq({
      method: 'POST',
      path: '/api/recovery/approve',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nocToken}`
      }
    }, { runId: testRecovery.id });
    assert.strictEqual(nocRes.status, 403, `Expected 403 for NOC Operator approving recovery, got ${nocRes.status}`);
    console.log('✔ Test 9 Passed: NOC Operator token on POST /api/recovery/approve returned 403 Forbidden');

    // 7c: SRE Lead token on POST /api/recovery/approve returns 200 (T0.5)
    const sreToken = session.generateToken({ username: 'sre_lead', role: 'SRE Lead' });
    const sreRes = await makeReq({
      method: 'POST',
      path: '/api/recovery/approve',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sreToken}`
      }
    }, { runId: testRecovery.id });
    assert.strictEqual(sreRes.status, 200, `Expected 200 for SRE Lead approving recovery, got ${sreRes.status}`);
    console.log('✔ Test 10 Passed: SRE Lead token on POST /api/recovery/approve returned 200 OK');

    // 7d: Cross-site form POST without CSRF token returns 403 (T0.21)
    const formPostRes = await makeReq({
      method: 'POST',
      path: '/api/settings',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, 'autonomousMode=true');
    assert.strictEqual(formPostRes.status, 403, `Expected 403 for cross-site form POST without CSRF token, got ${formPostRes.status}`);
    console.log('✔ Test 11 Passed: Cross-site form POST without CSRF token returned 403 Forbidden (T0.21)');

    process.env.NODE_ENV = origEnv;
  } finally {
    testServer.close();
  }

  console.log('=== ALL AUTHENTICATION & SECURITY TESTS PASSED ===\n');
}

if (require.main === module) {
  runAuthTests().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('❌ Auth test failed:', err);
    process.exit(1);
  });
}

module.exports = { runAuthTests };
