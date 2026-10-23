/**
 * tests/phase_o5_pool_member_check.test.js
 *
 * Phase O5 / O5.3 Acceptance Test:
 * Per-member VIP check [F3]: for each pool member host, compare its localhost timing;
 * flag "one member degraded" when one member's p95 exceeds 2× the median of the others.
 */
'use strict';

const assert = require('assert');
const {
  checkPoolMemberDegradation,
  runPoolMemberCheck
} = require('../backend/jobs/avi_overhead');

async function main() {
  console.log('=== PHASE O5.3: POOL MEMBER DEGRADATION CHECK TESTS ===');

  // Test 1: Balanced pool -> no degradation
  {
    const balancedPool = [
      { host: 'app-node-01', p95: 48 },
      { host: 'app-node-02', p95: 52 },
      { host: 'app-node-03', p95: 50 }
    ];
    const res = checkPoolMemberDegradation(balancedPool);
    assert.strictEqual(res.one_member_degraded, false);
    assert.strictEqual(res.degraded_host, null);
    assert.strictEqual(res.member_p95, null);
    console.log('✔ Balanced pool correctly reports no degradation');
  }

  // Test 2: One member degraded (p95 > 2× median of peers)
  {
    const degradedPool = [
      { host: 'node-a', p95: 50 },
      { host: 'node-b', p95: 52 },
      { host: 'node-c', p95: 220 } // Median of {50, 52} is 51; 220 > 2 * 51 (102)
    ];
    const res = checkPoolMemberDegradation(degradedPool);
    assert.strictEqual(res.one_member_degraded, true);
    assert.strictEqual(res.degraded_host, 'node-c');
    assert.strictEqual(res.member_p95, 220);
    assert.strictEqual(res.median_other_p95, 51);
    assert(res.ratio >= 4.3);
    assert(res.reason.includes('exceeds 2×'));
    console.log('✔ Degraded pool member correctly identified with literal expected flag and ratio');
  }

  // Test 3: Raw timings array calculates accurate p95
  {
    // 20 samples: 18 samples at 40ms, 2 at 500ms -> p95 = 500ms
    const samplesBad = Array(18).fill(40).concat([500, 500]);
    // 20 samples at 40ms -> p95 = 40ms
    const samplesGood1 = Array(20).fill(40);
    const samplesGood2 = Array(20).fill(42);

    const members = [
      { host: 'member-fast-1', timings: samplesGood1 },
      { host: 'member-fast-2', timings: samplesGood2 },
      { host: 'member-slow', timings: samplesBad }
    ];
    const res = checkPoolMemberDegradation(members);
    assert.strictEqual(res.one_member_degraded, true);
    assert.strictEqual(res.degraded_host, 'member-slow');
    assert.strictEqual(res.member_p95, 500);
    console.log('✔ Raw timings array parsed and p95 calculated accurately');
  }

  // Test 4: Insufficient pool members -> safe fallback
  {
    const singleMember = [{ host: 'standalone-01', p95: 500 }];
    const res1 = checkPoolMemberDegradation(singleMember);
    assert.strictEqual(res1.one_member_degraded, false);
    assert.strictEqual(res1.reason, 'INSUFFICIENT_POOL_MEMBERS');

    const empty = checkPoolMemberDegradation([]);
    assert.strictEqual(empty.one_member_degraded, false);
    console.log('✔ Edge cases (single member, empty pool) gracefully handled');
  }

  // Test 5: runPoolMemberCheck with mock ClickHouse client
  {
    let queriedSql = '';
    const fakeCh = {
      isConfigured: () => true,
      query: async (sql, params) => {
        queriedSql = sql;
        return [
          { component: 'bitbucket', entity_id: 'host:bb-01', p95_ms: '50.2', sample_count: 20 },
          { component: 'bitbucket', entity_id: 'host:bb-02', p95_ms: '52.0', sample_count: 22 },
          { component: 'bitbucket', entity_id: 'host:bb-03', p95_ms: '230.5', sample_count: 25 },
          { component: 'jira', entity_id: 'host:jira-01', p95_ms: '45.0', sample_count: 15 },
          { component: 'jira', entity_id: 'host:jira-02', p95_ms: '46.0', sample_count: 18 }
        ];
      }
    };

    const results = await runPoolMemberCheck({
      environments: ['prod'],
      ch: fakeCh,
      nowMs: 1700000000000,
      lookbackMinutes: 15
    });

    assert(queriedSql.includes('agent.localhost_ms'));
    assert(results.prod);
    assert.strictEqual(results.prod.bitbucket.one_member_degraded, true);
    assert.strictEqual(results.prod.bitbucket.degraded_host, 'bb-03');
    assert.strictEqual(results.prod.jira.one_member_degraded, false);
    console.log('✔ runPoolMemberCheck queries ClickHouse, groups by product, and evaluates degradation');
  }

  console.log('=== ALL PHASE O5.3 POOL MEMBER TESTS PASSED ===');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
