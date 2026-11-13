'use strict';

/**
 * tests/ldap_bind.test.js
 *
 * Acceptance test for real eLDAP sign-in outside production with group-based environments.
 */

const assert = require('assert');
const { startTestDirectory } = require('./fixtures/ldap_test_directory');
const ldapClient = require('../backend/auth/ldap_client');
const yamlConfig = require('../backend/config/yaml_config');

async function main() {
  console.log('=== RUNNING LDAP BIND ACCEPTANCE TESTS ===');

  const dir = await startTestDirectory({
    users: [
      {
        sAMAccountName: 'stg.user',
        password: 'Pw1!',
        mail: 'stg.user@enterprise.corp',
        memberOf: [
          'cn=sentinel-operators,ou=Groups,dc=enterprise,dc=corp',
          'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp'
        ]
      },
      {
        sAMAccountName: 'prod.user',
        password: 'Pw1!',
        mail: 'prod.user@enterprise.corp',
        memberOf: [
          'cn=sentinel-readonly,ou=Groups,dc=enterprise,dc=corp',
          'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp'
        ]
      },
      {
        sAMAccountName: 'both.user',
        password: 'Pw1!',
        mail: 'both.user@enterprise.corp',
        memberOf: [
          'cn=sentinel-sreleads,ou=Groups,dc=enterprise,dc=corp',
          'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp',
          'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp'
        ]
      },
      {
        sAMAccountName: 'nogroup.user',
        password: 'Pw1!',
        mail: 'nogroup.user@enterprise.corp',
        memberOf: []
      },
      {
        sAMAccountName: 'noenv.user',
        password: 'Pw1!',
        mail: 'noenv.user@enterprise.corp',
        memberOf: ['cn=sentinel-operators,ou=Groups,dc=enterprise,dc=corp']
      }
    ]
  });

  process.env.SENTINEL_AUTH_MODE = 'ldap';
  process.env.SSO_ELDAP_BIND = dir.bindPassword;

  const origLoadGlobal = yamlConfig.loadGlobalConfig;
  yamlConfig.loadGlobalConfig = () => ({
    environment: 'staging',
    sso_ldap_config: {
      ldap_url: dir.url,
      bind_dn: dir.bindDn,
      search_base: 'dc=enterprise,dc=corp'
    },
    security: {
      environment_groups: {
        'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp': ['prod'],
        'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp': ['staging']
      }
    }
  });

  try {
    let r = await ldapClient.authenticate('stg.user', 'Pw1!');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.user.role, 'NOC Operator');
    assert.deepStrictEqual(r.user.environments, ['staging']);
    assert.strictEqual(r.user.authenticatedVia, 'LDAP_BIND');
    assert.strictEqual('memberOf' in r.user, false);
    assert.strictEqual('dn' in r.user, false);

    r = await ldapClient.authenticate('STG.User', 'Pw1!');
    assert.strictEqual(r.user.username, 'stg.user');

    r = await ldapClient.authenticate('stg.user@enterprise.corp', 'Pw1!');
    assert.strictEqual(r.user.username, 'stg.user');

    r = await ldapClient.authenticate('prod.user', 'Pw1!');
    assert.deepStrictEqual(r.user.environments, ['prod']);

    r = await ldapClient.authenticate('both.user', 'Pw1!');
    assert.deepStrictEqual(r.user.environments.sort(), ['prod', 'staging']);

    r = await ldapClient.authenticate('stg.user', 'wrong');
    assert.strictEqual(r.code, 'BAD_CREDENTIALS');
    assert.strictEqual(r.error, 'Invalid LDAP credentials or bind failed.');

    r = await ldapClient.authenticate('ghost', 'Pw1!');
    assert.strictEqual(r.code, 'BAD_CREDENTIALS');
    assert.strictEqual(r.error, 'Invalid LDAP credentials or bind failed.');

    r = await ldapClient.authenticate('nogroup.user', 'Pw1!');
    assert.strictEqual(r.code, 'NO_ACCESS');

    r = await ldapClient.authenticate('noenv.user', 'Pw1!');
    assert.strictEqual(r.code, 'NO_ACCESS');

    await dir.stop();

    r = await ldapClient.authenticate('stg.user', 'Pw1!');
    assert.strictEqual(r.code, 'UNAVAILABLE');
    assert.notStrictEqual(r.user && r.user.authenticatedVia, 'STAGING_SIMULATION');

    console.log('✔ All ldap_bind acceptance tests passed');
  } finally {
    yamlConfig.loadGlobalConfig = origLoadGlobal;
    delete process.env.SENTINEL_AUTH_MODE;
    delete process.env.SSO_ELDAP_BIND;
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
