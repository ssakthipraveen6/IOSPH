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

  console.log('=== ALL AUTHENTICATION TESTS PASSED ===\n');
}

if (require.main === module) {
  runAuthTests().catch(err => {
    console.error('❌ Auth test failed:', err);
    process.exit(1);
  });
}

module.exports = { runAuthTests };
