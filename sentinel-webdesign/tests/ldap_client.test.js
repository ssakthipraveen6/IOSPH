/**
 * Test: LDAP sign-in and mapping of directory groups to roles.
 */
const assert = require('assert');
const ldapClient = require('../backend/auth/ldap_client');

async function runLdapTests() {
  console.log('=== RUNNING LDAP CLIENT & ROLE RESOLUTION TESTS (T0.6) ===');

  // Test 1: Staging authentication for allowed test users
  const adminAuth = await ldapClient.authenticate('admin_user@enterprise.corp', 'valid_pass');
  assert.strictEqual(adminAuth.success, true);
  assert.strictEqual(adminAuth.user.role, 'Super Admin');
  assert.strictEqual(adminAuth.user.authenticatedVia, 'STAGING_SIMULATION');
  console.log('✔ Test 1 Passed: Staging authentication succeeded with correct Super Admin role');

  // Test 2: Staging authentication for SRE lead test user
  const sreAuth = await ldapClient.authenticate('sre_lead_test', 'valid_pass');
  assert.strictEqual(sreAuth.success, true);
  assert.strictEqual(sreAuth.user.role, 'SRE Lead');
  console.log('✔ Test 2 Passed: SRE Lead role resolved correctly');

  // Test 3: Denied test passwords
  const deniedAuth = await ldapClient.authenticate('admin_user@enterprise.corp', 'wrong_password');
  assert.strictEqual(deniedAuth.success, false);
  console.log('✔ Test 3 Passed: Denied password correctly rejected');

  // Test 4: LDAP-unsafe characters rejected (LDAP injection prevention)
  const unsafeAuth = await ldapClient.authenticate('admin*()=test', 'pass');
  assert.strictEqual(unsafeAuth.success, false);
  assert.ok(unsafeAuth.error.includes('Invalid characters'));
  console.log('✔ Test 4 Passed: LDAP unsafe characters rejected');

  // Test 5: Role resolution from memberOf groups
  const superAdminRole = ldapClient.resolveRoleFromGroups([
    'cn=other-group,ou=Groups,dc=enterprise,dc=corp',
    'cn=sentinel-superadmins,ou=Groups,dc=enterprise,dc=corp'
  ]);
  assert.strictEqual(superAdminRole, 'Super Admin');

  const nocRole = ldapClient.resolveRoleFromGroups([
    'cn=sentinel-operators,ou=Groups,dc=enterprise,dc=corp'
  ]);
  assert.strictEqual(nocRole, 'NOC Operator');

  const defaultRole = ldapClient.resolveRoleFromGroups([
    'cn=unrecognized-group,ou=Groups,dc=enterprise,dc=corp'
  ]);
  assert.strictEqual(defaultRole, 'Operator');
  console.log('✔ Test 5 Passed: memberOf group DNs correctly map to roles');

  // Test 6: performLdapBind handles connection failure gracefully
  const bindResult = await ldapClient.performLdapBind({
    url: 'ldap://127.0.0.1:1', // Unreachable port
    bindDn: 'cn=svc,dc=corp',
    bindPassword: 'pass',
    searchBase: 'dc=corp',
    username: 'user',
    password: 'pass',
    timeout: 1000
  });
  assert.strictEqual(bindResult.success, false);
  assert.ok(bindResult.error.length > 0);
  console.log('✔ Test 6 Passed: performLdapBind handles unreachable LDAP server gracefully');

  console.log('=== ALL LDAP CLIENT TESTS PASSED ===\n');
}

runLdapTests().catch(err => {
  console.error('LDAP tests failed:', err);
  process.exit(1);
});
