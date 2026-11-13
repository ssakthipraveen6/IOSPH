'use strict';

/**
 * tests/env_access.test.js
 *
 * Tests for per-user environment access from AD groups and the session token.
 */

const assert = require('assert');
const yamlConfig = require('../backend/config/yaml_config');
const policy = require('../backend/auth/access_policy');
const session = require('../backend/auth/session');

session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');

// Save original loadGlobalConfig
const origLoad = yamlConfig.loadGlobalConfig;

try {
  console.log('=== RUNNING ENV ACCESS UNIT TESTS ===');

  // Stub yamlConfig.loadGlobalConfig with environment_groups
  yamlConfig.loadGlobalConfig = () => ({
    security: {
      environment_groups: {
        'CN=Sentinel-Env-Prod,OU=Groups,DC=enterprise,DC=corp': ['prod'],
        'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp': ['staging']
      }
    }
  });

  assert.deepStrictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=groups,dc=enterprise,dc=corp']), ['prod']);
  assert.deepStrictEqual(policy.environmentsFromGroups(['cn=other,dc=x']), []);
  assert.deepStrictEqual(policy.environmentsFromGroups([
    'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp',
    'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp'
  ]).sort(), ['prod', 'staging']);

  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'SRE Lead', environments: ['staging'] }), ['staging']);
  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Viewer', environments: ['prod', 'demo'] }), ['prod']);
  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Super Admin', environments: ['staging'] }), ['prod', 'staging']);

  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod'] }, 'staging'), 'prod');
  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod', 'staging'] }, 'staging'), 'staging');
  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: [] }, 'staging'), null);

  // with environment_groups = {}:
  yamlConfig.loadGlobalConfig = () => ({
    security: {
      environment_groups: {}
    }
  });
  assert.strictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp']), null);

  // token round trip:
  const t = session.generateToken({ username: 'a', role: 'Viewer', environments: ['staging'] });
  assert.deepStrictEqual(session.verifyToken(t).environments, ['staging']);
  assert.strictEqual('environments' in session.verifyToken(session.generateToken({ username: 'b', role: 'Viewer' })), false);

  console.log('✔ All env access unit tests passed');
} finally {
  yamlConfig.loadGlobalConfig = origLoad;
}
