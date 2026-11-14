/**
 * Sign-in against LDAP / eLDAP: binds as the user, reads group membership and maps it to a
 * Sentinel role. Outside production (or with SENTINEL_ALLOW_SIMULATED_LOGIN=true) the staging test
 * users are used instead.
 */
const fs = require('fs');
const ldap = require('ldapjs');
const yamlConfig = require('@sentinel/config/yaml_config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const config = require('@sentinel/config');
const accessPolicy = require('./access_policy');

// [SEC-03 REMEDIATED] — CWE-287: Authentication Bypass
// LDAP role mapping table — roles assigned from LDAP group memberships, NOT from username substrings.
// In production, this table is authoritative. Extend it to match your AD group naming convention.
// Escapes a value for use inside an LDAP search filter (RFC 4515).
function escapeFilter(v) { return String(v).replace(/[\\*()\x00]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')); }

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
  'viewer_readonly':            'Viewer',
  'stg_operator':               'NOC Operator',
  'prod_operator':              'NOC Operator'
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
 * Returns null if no matching group is found.
 * @param {string[]} memberOfGroups  Array of LDAP group DNs from the user's memberOf attribute
 * @returns {string|null} Resolved role or null
 */
function resolveRoleFromGroups(memberOfGroups = []) {
  const roleMap = getActiveLdapRoleMap();
  for (const groupDn of memberOfGroups) {
    const normalizedDn = String(groupDn).toLowerCase();
    for (const [mapDn, role] of Object.entries(roleMap)) {
      if (normalizedDn === mapDn.toLowerCase()) {
        return role;
      }
    }
  }
  return null;
}

/**
 * Performs real LDAP bind and group lookup using ldapjs (T0.6).
 * @param {object} opts Connection and bind options
 * @returns {Promise<{ success: boolean, user?: object, error?: string, code?: string }>}
 */
async function performLdapBind(opts) {
  const {
    url,
    bindDn,
    bindPassword,
    searchBase,
    username,
    password,
    tlsCaFile,
    timeout = 5000
  } = opts;

  return new Promise((resolve) => {
    let client;
    const clientOptions = {
      url,
      timeout,
      connectTimeout: timeout
    };
    if (tlsCaFile) {
      try {
        clientOptions.tlsOptions = { ca: [fs.readFileSync(tlsCaFile)] };
      } catch (err) {
        return resolve({
          success: false,
          code: 'UNAVAILABLE',
          error: `Sign-in service unavailable. Try again or contact the Sentinel admins.`
        });
      }
    }

    try {
      client = ldap.createClient(clientOptions);
    } catch (e) {
      return resolve({
        success: false,
        code: 'UNAVAILABLE',
        error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
      });
    }

    client.on('error', (err) => {
      console.warn(`[LDAP] Connection error to ${url}: ${err.message}`);
    });

    // 1. Bind with service account to locate user
    client.bind(bindDn, bindPassword, (bindErr) => {
      if (bindErr) {
        client.unbind(() => {});
        return resolve({
          success: false,
          code: 'UNAVAILABLE',
          error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
        });
      }

      // 2. Search for user by sAMAccountName, userPrincipalName, or mail
      const escaped = escapeFilter(username);
      const searchFilter = `(|(sAMAccountName=${escaped})(userPrincipalName=${escaped})(mail=${escaped}))`;
      const searchOptions = {
        scope: 'sub',
        filter: searchFilter,
        attributes: ['dn', 'mail', 'memberof', 'memberOf', 'displayname', 'displayName', 'samaccountname', 'sAMAccountName', 'userprincipalname', 'userPrincipalName']
      };

      client.search(searchBase, searchOptions, (searchErr, res) => {
        if (searchErr) {
          client.unbind(() => {});
          return resolve({
            success: false,
            code: 'UNAVAILABLE',
            error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
          });
        }

        let userEntry = null;
        let matchCount = 0;

        res.on('searchEntry', (entry) => {
          matchCount++;
          if (entry && entry.object) {
            userEntry = entry.object;
          } else if (entry) {
            const obj = {
              dn: (entry.objectName || entry._dn || '').toString()
            };
            const attrs = Array.isArray(entry.attributes) ? entry.attributes : (entry.pojo && Array.isArray(entry.pojo.attributes) ? entry.pojo.attributes : []);
            for (const a of attrs) {
              if (a && a.type) {
                const vals = a.values || a.vals || [];
                const val = Array.isArray(vals) && vals.length === 1 ? vals[0] : vals;
                obj[a.type] = val;
                obj[a.type.toLowerCase()] = val;
              }
            }
            userEntry = obj;
          }
        });

        res.on('error', (err) => {
          client.unbind(() => {});
          return resolve({
            success: false,
            code: 'UNAVAILABLE',
            error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
          });
        });

        res.on('end', (result) => {
          client.unbind(() => {});

          if (matchCount > 1) {
            return resolve({
              success: false,
              code: 'BAD_CREDENTIALS',
              error: 'Invalid LDAP credentials or bind failed.'
            });
          }

          if (!userEntry || !userEntry.dn) {
            return resolve({
              success: false,
              code: 'BAD_CREDENTIALS',
              error: 'Invalid LDAP credentials or bind failed.'
            });
          }

          // 3. Bind as the user with their password to verify credentials
          let userClient;
          try {
            userClient = ldap.createClient(clientOptions);
          } catch (e) {
            return resolve({
              success: false,
              code: 'UNAVAILABLE',
              error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
            });
          }

          userClient.on('error', () => {});

          userClient.bind(userEntry.dn, password, (userBindErr) => {
            userClient.unbind(() => {});
            if (userBindErr) {
              return resolve({
                success: false,
                code: 'BAD_CREDENTIALS',
                error: 'Invalid LDAP credentials or bind failed.'
              });
            }

            // Extract memberOf groups
            let memberOf = userEntry.memberOf || userEntry.memberof || [];
            if (!Array.isArray(memberOf)) {
              memberOf = [memberOf];
            }

            const role = resolveRoleFromGroups(memberOf);
            if (!role) {
              return resolve({
                success: false,
                code: 'NO_ACCESS',
                error: 'Your account is not in a Sentinel access group.'
              });
            }

            const envs = accessPolicy.environmentsFromGroups(memberOf);
            if (Array.isArray(envs) && envs.length === 0 && role !== 'Super Admin') {
              return resolve({
                success: false,
                code: 'NO_ACCESS',
                error: 'Your account has no Sentinel environment access (groups: sentinel-env-prod / sentinel-env-staging).'
              });
            }

            const email = userEntry.mail || (username.includes('@') ? username : `${username}@enterprise.corp`);
            const rawUsername = userEntry.sAMAccountName || userEntry.samaccountname || username;
            const normalizedUsername = String(rawUsername).toLowerCase();

            const userObj = {
              username: normalizedUsername,
              role,
              email,
              authenticatedVia: 'LDAP_BIND'
            };
            if (Array.isArray(envs)) {
              userObj.environments = envs;
            }

            return resolve({
              success: true,
              user: userObj
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
 * Real LDAP path runs when NODE_ENV === 'production' OR SENTINEL_AUTH_MODE === 'ldap'.
 * Staging test user table runs otherwise.
 *
 * @param {string} username   Username or UPN (e.g. jsmith or jsmith@enterprise.corp)
 * @param {string} password   Password
 * @returns {Promise<{ success: boolean, user?: object, error?: string, code?: string }>}
 */
async function authenticate(username, password) {
  // Input validation
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { success: false, code: 'BAD_CREDENTIALS', error: 'Username is required.' };
  }
  if (!password || typeof password !== 'string' || password.length === 0) {
    return { success: false, code: 'BAD_CREDENTIALS', error: 'Password is required.' };
  }

  // Sanitize: prevent LDAP injection by rejecting special DN characters in username
  const LDAP_UNSAFE = /[\\#+<>,;"=\x00]/;
  if (LDAP_UNSAFE.test(username)) {
    console.warn(`[LDAP] [SEC-03] Rejected username with LDAP-unsafe characters: ${username.substring(0, 20)}`);
    return { success: false, code: 'BAD_CREDENTIALS', error: 'Invalid characters in username.' };
  }

  const globalConfig = yamlConfig.loadGlobalConfig();
  const ldapConfig = globalConfig.sso_ldap_config || {};
  let infraLayers = {};
  try {
    infraLayers = yamlConfig.loadAllInfrastructureLayers() || {};
  } catch (_) {}

  const isExplicitLdap = process.env.SENTINEL_AUTH_MODE === 'ldap';
  const allowSimulated = process.env.SENTINEL_ALLOW_SIMULATED_LOGIN === 'true';
  // Every spelling of production (prod, prd, production) counts, not only the literal word.
  const isGlobalProd = !!globalConfig.environment
    && config.normalizeEnvironment(globalConfig.environment, 'config/global.yaml') === 'prod';
  let effectiveAllowSimulated = allowSimulated;
  if (isGlobalProd && allowSimulated) {
    console.warn('[LDAP] [SEC] Ignoring SENTINEL_ALLOW_SIMULATED_LOGIN: global configuration environment is production.');
    effectiveAllowSimulated = false;
  }
  const isProduction = process.env.NODE_ENV === 'production' && !effectiveAllowSimulated;

  // Real LDAP Bind is invoked if production or SENTINEL_AUTH_MODE === 'ldap'
  if (isExplicitLdap || isProduction) {
    let bindPassword = process.env.SSO_ELDAP_BIND || null;
    if (!bindPassword) {
      try {
        bindPassword = await credentialProvider.getCredential('sso_eldap', 'bind');
      } catch (e) {
        console.error(`[LDAP] [FATAL] Could not resolve bind credential from CyberArk or SSO_ELDAP_BIND: ${e.message}`);
        return {
          success: false,
          code: 'UNAVAILABLE',
          error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'
        };
      }
    }

    const ldapUrl = ldapConfig.ldap_url || ldapConfig.url || (infraLayers.sso_eldap && infraLayers.sso_eldap.endpoint) || 'ldaps://ldap.enterprise.corp:636';
    const bindDn = ldapConfig.bind_dn || 'cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp';
    const searchBase = ldapConfig.search_base || ldapConfig.base_dn || 'dc=enterprise,dc=corp';
    const tlsCaFile = ldapConfig.tls_ca_file || null;

    return await performLdapBind({
      url: ldapUrl,
      bindDn,
      bindPassword,
      searchBase,
      username,
      password,
      tlsCaFile
    });
  }

  // =========================================================================
  // STAGING / DEVELOPMENT PATH — Controlled test user table only
  // =========================================================================
  const lowerUser = username.toLowerCase().trim();

  // Explicit deny list for test credentials that should never succeed
  const DENY_PASSWORDS = ['invalid', 'wrong_password', 'test123', 'password'];
  if (DENY_PASSWORDS.includes(password.toLowerCase())) {
    return { success: false, code: 'BAD_CREDENTIALS', error: 'Invalid LDAP credentials or bind failed.' };
  }

  const role = STAGING_TEST_USERS[lowerUser] || 'Operator';
  const email = username.includes('@') ? username : `${username}@enterprise.corp`;

  if (process.env.NODE_ENV === 'production') {
    console.warn('[LDAP] [SECURITY] Simulated login is ON in a production process (SENTINEL_ALLOW_SIMULATED_LOGIN=true). Anyone can sign in. Use only on a staging server.');
  }
  console.info(`[LDAP] [STAGING] Authenticated user: ${username} with role: ${role}`);

  const userObj = {
    username: lowerUser,
    role,
    email,
    bindAccount: ldapConfig.bind_dn || 'cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp',
    authenticatedVia: 'STAGING_SIMULATION'
  };

  if (lowerUser === 'stg_operator') {
    userObj.environments = ['staging'];
  } else if (lowerUser === 'prod_operator') {
    userObj.environments = ['prod'];
  }

  return {
    success: true,
    user: userObj
  };
}

module.exports = {
  authenticate,
  resolveRoleFromGroups,
  performLdapBind,
  STAGING_TEST_USERS
};
