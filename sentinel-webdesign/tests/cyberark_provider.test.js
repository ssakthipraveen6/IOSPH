const assert = require('assert');
const path = require('path');
const { getCredential, resolveRegistryEntry, clearCache } = require('../backend/config/cyberark/credential_provider');

async function runTests() {
  console.log('=== RUNNING CYBERARK CREDENTIAL PROVIDER TESTS ===');

  // Test 1: Registry Lookup Resolution
  const bitbucketDb = resolveRegistryEntry('bitbucket', 'db');
  assert.deepStrictEqual(bitbucketDb, { safe: 'SF-BITBUCKET-PROD', object: 'BITBUCKET-DB-SVC' });
  console.log('✔ Test 1 Passed: resolveRegistryEntry for bitbucket/db');

  const infraAvi = resolveRegistryEntry('avi', 'api');
  assert.deepStrictEqual(infraAvi, { safe: 'SF-INFRA-AVI', object: 'AVI-API-SVC' });
  console.log('✔ Test 2 Passed: resolveRegistryEntry for shared infra avi');

  // Test 2: CyberArk Fetch Resolution (Subprocess Bridge)
  clearCache();
  const credVal = await getCredential('bitbucket', 'db');
  assert.strictEqual(credVal, 'CYBERARK_SECRET_SF-BITBUCKET-PROD_BITBUCKET-DB-SVC');
  console.log('✔ Test 3 Passed: getCredential returned resolved CyberArk secret');

  // Test 3: In-Memory Cache Hit
  const start = Date.now();
  const cachedVal = await getCredential('bitbucket', 'db');
  const duration = Date.now() - start;
  assert.strictEqual(cachedVal, credVal);
  assert(duration < 20, `Cache hit should take < 20ms, took ${duration}ms`);
  console.log('✔ Test 4 Passed: Cache hit successfully returned without subprocess overhead');

  // Test 4: Fallback to Environment Variables
  clearCache();
  process.env['UNKNOWNAPP_APITOKEN'] = 'FALLBACK_ENV_TOKEN_VAL';
  const fallbackVal = await getCredential('unknownapp', 'apitoken');
  assert.strictEqual(fallbackVal, 'FALLBACK_ENV_TOKEN_VAL');
  delete process.env['UNKNOWNAPP_APITOKEN'];
  console.log('✔ Test 5 Passed: Fallback to process.env succeeded when CyberArk entry is missing');

  // Test 5: Exception when credential cannot be resolved
  clearCache();
  let errorCaught = false;
  try {
    await getCredential('nonexistent_app', 'nonexistent_purpose');
  } catch (e) {
    errorCaught = true;
    assert(e.message.includes('No credential resolved'), e.message);
  }
  assert.strictEqual(errorCaught, true);
  console.log('✔ Test 6 Passed: Exception correctly thrown when credential resolution fails');

  console.log('=== ALL CYBERARK CREDENTIAL PROVIDER TESTS PASSED ===\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
