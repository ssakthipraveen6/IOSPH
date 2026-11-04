// Regression test for SF-06: startup safety guard
const assert = require('assert');
const { assertSafeStartup } = require('../backend/server');

// Runs SF-06 startup safety guard assertions
function runStartupGuardTests() {
  console.log('=== RUNNING STARTUP SAFETY GUARD TESTS (SF-06) ===');

  // Assert error message for {} with host 0.0.0.0
  const errHostAll = assertSafeStartup({}, '0.0.0.0');
  assert.ok(typeof errHostAll === 'string' && errHostAll.includes('Refusing to listen on 0.0.0.0'), 'Must refuse 0.0.0.0 without production or dev flag');
  console.log('✔ Test 1 Passed: 0.0.0.0 rejected with empty env');

  // Assert null for {NODE_ENV:'production'} with 0.0.0.0
  const okProd = assertSafeStartup({ NODE_ENV: 'production' }, '0.0.0.0');
  assert.strictEqual(okProd, null, 'Must allow 0.0.0.0 when NODE_ENV=production');
  console.log('✔ Test 2 Passed: 0.0.0.0 allowed when NODE_ENV=production');

  // Assert null for {} with 127.0.0.1
  const okLoopback = assertSafeStartup({}, '127.0.0.1');
  assert.strictEqual(okLoopback, null, 'Must allow 127.0.0.1 with empty env');
  console.log('✔ Test 3 Passed: 127.0.0.1 allowed with empty env');

  // Assert null for {SENTINEL_DEV:'true'} with 0.0.0.0
  const okDev = assertSafeStartup({ SENTINEL_DEV: 'true' }, '0.0.0.0');
  assert.strictEqual(okDev, null, 'Must allow 0.0.0.0 when SENTINEL_DEV=true');
  console.log('✔ Test 4 Passed: 0.0.0.0 allowed when SENTINEL_DEV=true');

  console.log('=== ALL STARTUP GUARD TESTS PASSED ===');
  process.exit(0);
}

runStartupGuardTests();
