'use strict';

/**
 * tests/sentinelql.test.js
 *
 * M7 Task 7.1 Test Suite: SentinelQL lexer, parser, ClickHouse compiler,
 * injection rejection, time/row limits, and environment parameter injection.
 */

const assert = require('assert');
const sentinelql = require('@sentinel/sentinelql');

async function runTests() {
  console.log('=== Running SentinelQL Parser & Compiler Test Suite ===\n');

  // 1. Basic Tokenization and Parsing
  console.log('[TEST 1] Lexing and parsing valid metrics query...');
  const q1 = 'metrics where product = "artifactory" and metric = "journey.step.duration_ms" | percentile(95) by step every 5m since 24h';
  const compiled1 = sentinelql.compile(q1, { environment: 'production' });

  assert(compiled1.sql, 'compiled SQL should exist');
  assert(compiled1.sql.includes('FROM sentinel.metrics'), 'should query sentinel.metrics table');
  assert(compiled1.sql.includes('quantile(0.95)(value)'), 'should compile percentile(95) to quantile(0.95)');
  assert(compiled1.sql.includes('toStartOfInterval(ts, INTERVAL 5 MINUTE)'), 'should compile every 5m');
  assert(compiled1.sql.includes('GROUP BY bucket_ts, step'), 'should group by bucket_ts and step');
  assert.strictEqual(compiled1.meta.dataset, 'metrics');

  // Verify parameters are used rather than raw literal values
  assert(!compiled1.sql.includes("'artifactory'"), 'SQL must not contain raw string literal artifactory');
  assert(!compiled1.sql.includes("'journey.step.duration_ms'"), 'SQL must not contain raw string literal metric name');
  const paramValues = Object.values(compiled1.params);
  assert(paramValues.includes('artifactory'), 'params must contain artifactory');
  assert(paramValues.includes('journey.step.duration_ms'), 'params must contain journey.step.duration_ms');
  assert(paramValues.includes('production'), 'params must contain server-injected environment');
  console.log('  -> PASSED: Valid metrics query correctly parsed and compiled with parameters');

  // 2. Server-side environment isolation
  console.log('[TEST 2] Server-side environment injection...');
  const compiledStaging = sentinelql.compile('logs where level = "error"', { environment: 'staging' });
  assert(Object.values(compiledStaging.params).includes('staging'), 'staging environment must be injected');

  const compiledDemo = sentinelql.compile('logs where level = "error"', { environment: 'demo' });
  assert(Object.values(compiledDemo.params).includes('demo'), 'demo environment must be injected');
  console.log('  -> PASSED: Environment strictly injected server-side');

  // 3. Spans query and aliases
  console.log('[TEST 3] Spans query with duration filter...');
  const q3 = 'spans where service = "artifactory" and duration_ms > 1000 | count() by name since 1h limit 50';
  const compiled3 = sentinelql.compile(q3, { environment: 'production' });

  assert(compiled3.sql.includes('FROM sentinel.spans'), 'should query sentinel.spans table');
  assert(compiled3.sql.includes('start_ts >='), 'spans time column must be start_ts');
  assert(compiled3.sql.includes('count() AS count'), 'should count spans');
  assert(Object.values(compiled3.params).includes(1000), 'params must include duration limit 1000');
  assert.strictEqual(compiled3.meta.limit, 50, 'limit should be 50');
  console.log('  -> PASSED: Spans query correctly compiled');

  // 4. SQL Injection Rejection: Semicolons
  console.log('[TEST 4] Rejecting statement terminator (semicolon)...');
  assert.throws(() => {
    sentinelql.compile('metrics where product = "artifactory"; DROP TABLE metrics;', { environment: 'production' });
  }, /statement terminator ';' is strictly forbidden/);
  console.log('  -> PASSED: Semicolon injection rejected');

  // 5. SQL Injection Rejection: Comments
  console.log('[TEST 5] Rejecting comments (-- and /* */)...');
  assert.throws(() => {
    sentinelql.compile('metrics where product = "artifactory" -- comment', { environment: 'production' });
  }, /comments are strictly forbidden/);

  assert.throws(() => {
    sentinelql.compile('metrics where product = "artifactory" /* comment */', { environment: 'production' });
  }, /comments are strictly forbidden/);
  console.log('  -> PASSED: Comments rejected');

  // 6. SQL Injection Rejection: Forbidden / Unknown Tables
  console.log('[TEST 6] Rejecting unknown tables (allow-list enforcement)...');
  assert.throws(() => {
    sentinelql.compile('users where role = "admin"', { environment: 'production' });
  }, /unknown or forbidden dataset 'users'/);

  assert.throws(() => {
    sentinelql.compile('system_settings where id = 1', { environment: 'production' });
  }, /unknown or forbidden dataset 'system_settings'/);
  console.log('  -> PASSED: Forbidden tables rejected');

  // 7. SQL Injection Rejection: Forbidden Columns
  console.log('[TEST 7] Rejecting unknown columns...');
  assert.throws(() => {
    sentinelql.compile('metrics where password_hash = "abc"', { environment: 'production' });
  }, /invalid or forbidden column 'password_hash'/);
  console.log('  -> PASSED: Unknown columns rejected');

  // 8. Time limit enforcement: > 400 days rejected
  console.log('[TEST 8] Time retention limits (max 400 days)...');
  assert.throws(() => {
    sentinelql.compile('metrics where product = "artifactory" since 500d', { environment: 'production' });
  }, /exceeds maximum allowed retention of 400 days/);

  const compiled400d = sentinelql.compile('metrics where product = "artifactory" since 400d', { environment: 'production' });
  assert(compiled400d.sql.includes('INTERVAL 400 DAY'), '400d must be accepted');
  console.log('  -> PASSED: Retention limit enforced');

  // 9. Row limit capping: Max 10,000 rows
  console.log('[TEST 9] Row limit capping (max 10,000)...');
  const compiledLargeLimit = sentinelql.compile('metrics where product = "artifactory" limit 50000', { environment: 'production' });
  assert.strictEqual(compiledLargeLimit.meta.limit, 10000, 'Limit should be clamped to 10,000');
  console.log('  -> PASSED: Row limit capped to 10,000');

  // 10. Execution with inert ClickHouse fallback
  console.log('[TEST 10] Execution fallback when ClickHouse is unconfigured...');
  const execResult = await sentinelql.execute('metrics where product = "artifactory" since 1h', { environment: 'production' });
  assert.strictEqual(execResult.ok, true, 'execution must return ok: true');
  assert.strictEqual(execResult.data.length, 0, 'data must be empty array');
  assert(execResult.meta, 'meta must be present');
  console.log('  -> PASSED: Inert ClickHouse fallback handled gracefully');

  console.log('\n=== All SentinelQL Tests Passed Successfully ===');
}

runTests().catch(err => {
  console.error('\n[FATAL] SentinelQL test failed:', err);
  process.exit(1);
});
