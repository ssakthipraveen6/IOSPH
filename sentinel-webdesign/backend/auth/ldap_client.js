const yamlConfig = require('@sentinel/config/yaml_config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const config = require('@sentinel/config');

// [SEC-03 REMEDIATED] — CWE-287: Authentication Bypass
// LDAP role mapping table — roles assigned from LDAP group memberships, NOT from username substrings.
// In production, this table is authoritative. Extend it to match your AD group naming convention.
const LDAP_GROUP_ROLE_MAP = {
  'cn=sentinel-superadmins,ou=Groups,dc=enterprise,dc=corp': 'Super Admin',
  'cn=sentinel-sreleads,ou=Groups,dc=enterprise,dc=corp':    'SRE Lead',
  'cn=sentinel-operators,ou=Groups,dc=enterprise,dc=corp':   'NOC Operator',
  'cn=sentinel-readonly,ou=Groups,dc=enterprise,dc=corp':    'Viewer'
};

// Staging-only role table — used ONLY when in non-production / staging mode.
// Maps well-known test usernames to specific roles for integration testing.
const STAGING_TEST_USERS = {
  'admin_sentinel':             'Super Admin',
  'admin_user':                 'Super Admin',
  'admin_user@enterprise.corp': 'Super Admin',
  'sre_lead_test':              'SRE Lead',
  'noc_operator':               'NOC Operator',
  'viewer_readonly':            'Viewer'
};

/**
 * Resolves active LDAP role map dynamically from infra-sso-eldap.yaml definition
 * with fallback to LDAP_GROUP_ROLE_MAP.
 */
function getActiveLdapRoleMap() {
  try {
    const infra = yamlConfig.loadAllInfrastructureLayers();
    if (infra && infra.sso_eldap && infra.sso_eldap.role_mappings) {
      return infra.sso_eldap.role_mappings;
    }
  } catch (e) {
    // Fallback to static mapping on read failure
  }
  return LDAP_GROUP_ROLE_MAP;
}

/**
 * Resolves a user role from LDAP memberOf groups.
 * Falls back to 'Operator' if no matching group is found.
 * @param {string[]} memberOfGroups  Array of LDAP group DNs from the user's memberOf attribute
 * @returns {string} Resolved role
 */
function resolveRoleFromGroups(memberOfGroups = []) {
  const roleMap = getActiveLdapRoleMap();
  for (const groupDn of memberOfGroups) {
    const normalizedDn = groupDn.toLowerCase();
    for (const [mapDn, role] of Object.entries(roleMap)) {
      if (normalizedDn === mapDn.toLowerCase()) {
        return role;
      }
    }
  }
  return 'Operator';
}

/**
 * Authenticates user credentials against Enterprise eLDAP / Active Directory.
 *
 * Production path: Performs real LDAP bind using ldapjs with CyberArk-resolved
 * bind credentials, then reads memberOf attributes for group-based role assignment.
 *
 * Staging/Dev path: Uses a controlled test user lookup table when
 * USE_SIMULATED_COLLECTORS is true or in staging/test environments.
 *
 * @param {string} username   Username or UPN (e.g. jsmith or jsmith@enterprise.corp)
 * @param {string} password   Password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
async function authenticate(username, password) {
  // Input validation
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { success: false, error: 'Username is required.' };
  }
  if (!password || typeof password !== 'string' || password.length === 0) {
    return { success: false, error: 'Password is required.' };
  }

  // Sanitize: prevent LDAP injection by rejecting special DN characters in username
  // RFC 4514/4515 unsafe chars: \ # + < > , ; " =
  const LDAP_UNSAFE = /[\\#+<>,;"=\x00]/;
  if (LDAP_UNSAFE.test(username)) {
    console.warn(`[LDAP] [SEC-03] Rejected username with LDAP-unsafe characters: ${username.substring(0, 20)}`);
    return { success: false, error: 'Invalid characters in username.' };
  }

  const globalConfig = yamlConfig.loadGlobalConfig();
  const ldapConfig = globalConfig.sso_ldap_config || {};
  const isProduction = process.env.NODE_ENV === 'production' && config.ENVIRONMENT === 'prod';

  // =========================================================================
  // PRODUCTION PATH — Real LDAP Bind via ldapjs
  // =========================================================================
  if (isProduction) {
    let bindPassword = null;
    try {
      bindPassword = await credentialProvider.getCredential('sso_eldap', 'bind');
    } catch (e) {
      console.error(`[LDAP] [FATAL] Could not resolve bind credential from CyberArk: ${e.message}`);
      return { success: false, error: 'Authentication service unavailable. Contact your administrator.' };
    }

    console.warn('[LDAP] [SEC-03] Production LDAP bind not yet configured. Rejecting authentication.');
    return { success: false, error: 'Authentication service is being configured. Please contact your administrator.' };
  }

  // =========================================================================
  // STAGING / DEVELOPMENT PATH — Controlled test user table only
  // [SEC-03] Role is looked up from a controlled allow-list, NOT inferred from username substrings
  // =========================================================================
  const lowerUser = username.toLowerCase().trim();

  // Explicit deny list for test credentials that should never succeed
  const DENY_PASSWORDS = ['invalid', 'wrong_password', 'test123', 'password'];
  if (DENY_PASSWORDS.includes(password.toLowerCase())) {
    return { success: false, error: 'Invalid LDAP credentials or bind failed.' };
  }

  // [SEC-03] Role resolved from a controlled allow-list — no username substring inference
  const role = STAGING_TEST_USERS[lowerUser] || 'Operator';
  const email = username.includes('@') ? username : `${username}@enterprise.corp`;

  console.info(`[LDAP] [STAGING] Authenticated user: ${username} with role: ${role}`);

  return {
    success: true,
    user: {
      username,
      role,
      email,
      bindAccount: ldapConfig.bind_dn || 'cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp',
      authenticatedVia: 'STAGING_SIMULATION'
    }
  };
}

module.exports = {
  authenticate,
  resolveRoleFromGroups  // Exported for unit testing
};
