const assert = require('assert');
const yamlConfig = require('../backend/config/yaml_config');
const config = require('../backend/config/config');

function runSchemaTests() {
  console.log('=== RUNNING MULTI-LAYER SCHEMA & VALIDATION TESTS ===');

  // Test 1: Config Validation Suite
  let valid = false;
  try {
    valid = yamlConfig.validateConfig();
  } catch (e) {
    console.error('Validation error:', e.message);
  }
  assert.strictEqual(valid, true);
  console.log('✔ Test 1 Passed: validateConfig() succeeded for all application YAMLs and registry entries');

  // Test 2: Infrastructure Layers Loaded
  const infra = yamlConfig.loadAllInfrastructureLayers();
  const expectedInfraKeys = ['sso_eldap', 'avi', 'nfs', 'unix', 'windows', 'docker', 'k8s'];
  expectedInfraKeys.forEach(key => {
    assert(infra[key], `Missing infrastructure layer config for ${key}`);
    assert(infra[key].poll_interval_seconds > 0, `Missing poll_interval_seconds for ${key}`);
  });
  console.log('✔ Test 2 Passed: All 7 shared infrastructure layer defaults loaded');

  // Test 3: Application Multi-Layer Mapping
  const apps = config.PROD_URLS.applications;
  assert(apps.bitbucket, 'bitbucket app missing from config');
  assert.strictEqual(apps.bitbucket.layers.sso.credential_purpose, 'sso');
  assert.strictEqual(apps.bitbucket.layers.db.credential_purpose, 'db');
  console.log('✔ Test 3 Passed: Application multi-layer properties properly mapped to purpose tokens');

  // Test 4: Path Traversal Sanitization Protection
  assert.strictEqual(yamlConfig.sanitizeAppId('bitbucket'), 'bitbucket');
  assert.strictEqual(yamlConfig.sanitizeAppId('jfrog_artifactory'), 'jfrog_artifactory');
  assert.strictEqual(yamlConfig.sanitizeAppId('app-123'), 'app-123');

  let traversalBlocked = false;
  try {
    yamlConfig.sanitizeAppId('../../etc/passwd');
  } catch (e) {
    traversalBlocked = true;
    assert(e.message.includes('[SECURITY] Invalid appId'));
  }
  assert.strictEqual(traversalBlocked, true);
  console.log('✔ Test 4 Passed: Path traversal attempts in appId are strictly rejected');

  // Test 5: ACTIVE_URLS Resolution
  assert(config.ACTIVE_URLS, 'ACTIVE_URLS must be defined');
  assert(config.ENVIRONMENT, 'ENVIRONMENT must be defined');
  assert(typeof config.IS_PROD === 'boolean', 'IS_PROD must be boolean');
  console.log(`✔ Test 5 Passed: Dynamic ACTIVE_URLS resolved for environment: [${config.ENVIRONMENT.toUpperCase()}]`);

  // Test 6: Unified Definitions Directory Loading (Option A)
  assert(yamlConfig.DEFINITIONS_DIR, 'DEFINITIONS_DIR must be exported');
  const allApps = yamlConfig.loadAllApplications();
  assert(allApps.bitbucket, 'Bitbucket must be loaded from definitions');
  assert(allApps.bitbucket.metrics, 'Bitbucket unified manifest must include metrics definition');
  assert(allApps.bitbucket.logs, 'Bitbucket unified manifest must include logs definition');
  assert(allApps.bitbucket.credentials, 'Bitbucket unified manifest must include credentials definition');
  const allInfra = yamlConfig.loadAllInfrastructureLayers();
  assert(allInfra.avi, 'AVI must be loaded from definitions');
  assert(allInfra.windows, 'Windows must be loaded from definitions');
  console.log('✔ Test 6 Passed: Unified definitions (Option A) loaded with metrics, logs, and credentials');

  // Test 7: Unified Root Config Directory Loading (Option 2)
  assert(yamlConfig.ROOT_CONFIG_DIR, 'ROOT_CONFIG_DIR must be exported');
  assert(yamlConfig.ROOT_APPS_DIR, 'ROOT_APPS_DIR must be exported');
  assert(yamlConfig.ROOT_INFRA_DIR, 'ROOT_INFRA_DIR must be exported');
  const fs = require('fs');
  assert(fs.existsSync(yamlConfig.ROOT_CONFIG_DIR), 'Root config directory must exist');
  assert(fs.existsSync(yamlConfig.ROOT_APPS_DIR), 'Root config/apps directory must exist');
  assert(fs.existsSync(yamlConfig.ROOT_INFRA_DIR), 'Root config/infra directory must exist');
  assert(allApps.jenkins, 'Jenkins must be loaded from root config/apps');
  assert(allInfra.k8s, 'K8s must be loaded from root config/infra');
  console.log('✔ Test 7 Passed: Unified root config directory (Option 2) verified with full app/infra targets');

  console.log('=== ALL SCHEMA VALIDATION TESTS PASSED ===\n');
}

if (require.main === module) {
  runSchemaTests();
}

module.exports = { runSchemaTests };
