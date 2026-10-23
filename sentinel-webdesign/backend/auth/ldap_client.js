/**
 * Sign-in against LDAP / eLDAP: binds as the user, reads group membership and maps it to a
 * Sentinel role. Outside production (or with SENTINEL_ALLOW_SIMULATED_LOGIN=true) the staging test
 * users are used instead.
 */
const ldap = require('ldapjs');
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
  'admin_user@enterprise.corp': 'Super Admin', // sample-data-ok
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
 * Performs real LDAP bind and group lookup using ldapjs (T0.6).
 * @param {object} opts Connection and bind options
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
async function performLdapBind(opts) {
  const {
    url,
    bindDn,
    bindPassword,
    searchBase,
    username,
    password,
    timeout = 5000
  } = opts;

  return new Promise((resolve) => {
    let client;
    try {
      client = ldap.createClient({
        url,
        timeout,
        connectTimeout: timeout
      });
    } catch (e) {
      return resolve({ success: false, error: `LDAP client error: ${e.message}` });
    }

    client.on('error', (err) => {
      console.warn(`[LDAP] Connection error to ${url}: ${err.message}`);
    });

    // 1. Bind with service account to locate user
    client.bind(bindDn, bindPassword, (bindErr) => {
      if (bindErr) {
        client.unbind(() => {});
        return resolve({ success: false, error: `LDAP service bind failed: ${bindErr.message}` });
      }

      // 2. Search for user by sAMAccountName, userPrincipalName, or mail
      const searchFilter = `(|(sAMAccountName=${username})(userPrincipalName=${username})(mail=${username}))`;
      const searchOptions = {
        scope: 'sub',
        filter: searchFilter,
        attributes: ['dn', 'mail', 'memberOf', 'displayName', 'sAMAccountName']
      };

      client.search(searchBase, searchOptions, (searchErr, res) => {
        if (searchErr) {
          client.unbind(() => {});
          return resolve({ success: false, error: `LDAP search failed: ${searchErr.message}` });
        }

        let userEntry = null;

        res.on('searchEntry', (entry) => {
          userEntry = entry.object;
        });

        res.on('error', (err) => {
          client.unbind(() => {});
          return resolve({ success: false, error: `LDAP search stream error: ${err.message}` });
        });

        res.on('end', (result) => {
          client.unbind(() => {});

          if (!userEntry || !userEntry.dn) {
            return resolve({ success: false, error: 'User not found in directory.' });
          }

          // 3. Bind as the user with their password to verify credentials
          let userClient;
          try {
            userClient = ldap.createClient({ url, timeout, connectTimeout: timeout });
          } catch (e) {
            return resolve({ success: false, error: `User LDAP client creation failed: ${e.message}` });
          }

          userClient.on('error', () => {});

          userClient.bind(userEntry.dn, password, (userBindErr) => {
            userClient.unbind(() => {});
            if (userBindErr) {
              return resolve({ success: false, error: 'Invalid LDAP credentials or bind failed.' });
            }

            // Extract memberOf groups
            let memberOf = userEntry.memberOf || [];
            if (!Array.isArray(memberOf)) {
              memberOf = [memberOf];
            }

            const role = resolveRoleFromGroups(memberOf);
            const email = userEntry.mail || (username.includes('@') ? username : `${username}@enterprise.corp`);

            return resolve({
              success: true,
              user: {
                username,
                role,
                email,
                dn: userEntry.dn,
                memberOf,
                authenticatedVia: 'LDAP_BIND'
              }
            });
          });
        });
      });
    });
  });
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
  let infraLayers = {};
  try {
    infraLayers = yamlConfig.loadAllInfrastructureLayers() || {};
  } catch (_) {}

  // The real LDAP bind is used whenever NODE_ENV=production. The simulated login (any user, any
  // password) used to be reachable on a production server whose config said environment: staging,
  // because one server serves both the PRD and STG views. It now needs an explicit opt-in.
  const isProduction = process.env.NODE_ENV === 'production' && process.env.SENTINEL_ALLOW_SIMULATED_LOGIN !== 'true';

  // =========================================================================
  // PRODUCTION PATH — Real LDAP Bind via ldapjs (T0.6)
  // =========================================================================
  if (isProduction) {
    let bindPassword = null;
    try {
      bindPassword = await credentialProvider.getCredential('sso_eldap', 'bind');
    } catch (e) {
      console.error(`[LDAP] [FATAL] Could not resolve bind credential from CyberArk: ${e.message}`);
      return { success: false, error: 'Authentication service unavailable. Contact your administrator.' };
    }

    const ldapUrl = ldapConfig.ldap_url || ldapConfig.url || (infraLayers.sso_eldap && infraLayers.sso_eldap.endpoint) || 'ldaps://ldap.enterprise.corp:636';
    const bindDn = ldapConfig.bind_dn || 'cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp';
    const searchBase = ldapConfig.search_base || 'dc=enterprise,dc=corp';

    return await performLdapBind({
      url: ldapUrl,
      bindDn,
      bindPassword,
      searchBase,
      username,
      password
    });
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

  if (process.env.NODE_ENV === 'production') {
    console.warn('[LDAP] [SECURITY] Simulated login is ON in a production process (SENTINEL_ALLOW_SIMULATED_LOGIN=true). Anyone can sign in. Use only on a staging server.');
  }
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
  resolveRoleFromGroups,
  performLdapBind
};
