const assert = require('assert');
const ldapClient = require('../apps/api/src/auth/ldap_client');
const session = require('../apps/api/src/auth/session');

async function runAuthTests() {
  console.log('=== RUNNING AUTHENTICATION & ROLE LOCKDOWN TESTS ===');

  // Test 1: eLDAP Authentication
  const authRes = await ldapClient.authenticate('admin_user@enterprise.corp', 'secret_pass');
  assert.strictEqual(authRes.success, true);
  assert.strictEqual(authRes.user.role, 'Super Admin');
  console.log('✔ Test 1 Passed: eLDAP authentication succeeded for admin user');

  const invalidAuth = await ldapClient.authenticate('user', 'wrong_password');
  assert.strictEqual(invalidAuth.success, false);
  console.log('✔ Test 2 Passed: eLDAP authentication failed for invalid password');

  // Test 2: Token Generation and Verification
  const token = session.generateToken(authRes.user);
  assert(token.length > 20);

  const verified = session.verifyToken(token);
  assert.strictEqual(verified.username, 'admin_user@enterprise.corp');
  assert.strictEqual(verified.role, 'Super Admin');
  console.log('✔ Test 3 Passed: JWT session token generation and verification succeeded');

  // Test 3: Expired / Corrupted Token Rejection
  const invalidToken = session.verifyToken('invalid.token.signature');
  assert.strictEqual(invalidToken, null);
  console.log('✔ Test 4 Passed: Invalid token signature rejected');

  // Test 4: Strict CORS Origin Validation (Task 8)
  const { isAllowedOrigin, createCorsOriginCallback } = require('../apps/api/src/cors_validator');
  const allowedList = ['https://sentinel.yourbank.internal', 'http://localhost:5173'];

  // Legitimate intranet and explicitly allowed origins
  assert.strictEqual(isAllowedOrigin('https://sentinel.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('https://refweb.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('https://dashboards.refweb.internal.corp', allowedList), true);
  assert.strictEqual(isAllowedOrigin('http://localhost:5173', allowedList), true);
  assert.strictEqual(isAllowedOrigin(null, allowedList), true); // Server-to-server / CLI

  // Crafted / malicious attacker origins that would have passed loose .includes('refweb') / .endsWith('.corp')
  assert.strictEqual(isAllowedOrigin('https://notrefweb.attacker.com', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://attacker.com/refweb-phish', allowedList), false);
  assert.strictEqual(isAllowedOrigin('https://evilcorp.com', allowedList), false);
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
  corsCallback('https://notrefweb.attacker.com', (err, allow) => {
    assert(err instanceof Error);
    assert(err.message.includes('CORS: Origin'));
    rejected = true;
  });
  assert.strictEqual(rejected, true);

  console.log('✔ Test 5 Passed: CORS origin validation strictly rejects crafted origins and accepts corporate intranet origins');

  console.log('=== ALL AUTHENTICATION & SECURITY TESTS PASSED ===\n');
}

if (require.main === module) {
  runAuthTests().catch(err => {
    console.error('❌ Auth test failed:', err);
    process.exit(1);
  });
}

module.exports = { runAuthTests };
