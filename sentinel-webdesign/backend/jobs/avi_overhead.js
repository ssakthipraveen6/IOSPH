/**
 * backend/jobs/avi_overhead.js — P2
 *
 * avi.overhead_ms = vip.total_ms (probe through AVI) − agent.localhost_ms (agent on the
 * product host) for the same product and the same minute, read from ClickHouse.
 * Only minutes where BOTH series exist produce a value; nothing is estimated.
 */

const clickhouse = require('../../database/clickhouse');
const db = require('../../database/db');

const lastWrittenMinute = new Map(); // `${env}:${product}` -> minute epoch ms

const OVERHEAD_SQL = `SELECT component,
       toUnixTimestamp64Milli(toDateTime64(toStartOfMinute(ts), 3, 'UTC')) AS minute_ms,
       avgIf(value, metric_name = 'vip.total_ms') AS vip_ms,
       avgIf(value, metric_name = 'agent.localhost_ms') AS local_ms,
       countIf(metric_name = 'vip.total_ms') AS n_vip,
       countIf(metric_name = 'agent.localhost_ms') AS n_local
FROM metrics
WHERE env = {env:String}
  AND metric_name IN ('vip.total_ms', 'agent.localhost_ms')
  AND ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
  AND ts < fromUnixTimestamp64Milli({until:Int64}, 'UTC')
GROUP BY component, minute_ms
HAVING n_vip > 0 AND n_local > 0
ORDER BY minute_ms ASC`;

/**
 * @returns {Promise<object>} summary per environment
 */
async function runAviOverhead({ environments = ['prod', 'staging'], ch = clickhouse, store = db, nowMs = Date.now(), lookbackMinutes = 3 } = {}) {
  if (!ch.isConfigured()) {
    return { skipped: true, reason: 'ClickHouse not configured (needs both vip.total_ms and agent.localhost_ms history)' };
  }
  const until = Math.floor(nowMs / 60000) * 60000; // last complete minute boundary
  const since = until - lookbackMinutes * 60000;
  const summary = {};

  for (const env of environments) {
    const rows = await ch.query(OVERHEAD_SQL, { env, since, until });
    const batch = [];
    for (const r of rows) {
      const product = r.component;
      const minute = Number(r.minute_ms);
      const key = `${env}:${product}`;
      if ((lastWrittenMinute.get(key) || 0) >= minute) continue;
      const vipMs = Number(r.vip_ms);
      const localMs = Number(r.local_ms);
      if (!Number.isFinite(vipMs) || !Number.isFinite(localMs)) continue;
      batch.push({
        component: product,
        entity_id: `app:${product}`,
        metricName: 'avi.overhead_ms',
        value: Math.max(0, vipMs - localMs),
        timestamp: new Date(minute).toISOString(),
        env,
        source: 'probe',
        attributes: { derived_from: 'vip.total_ms-agent.localhost_ms' }
      });
      lastWrittenMinute.set(key, minute);
    }
    if (batch.length > 0) store.addMetricBatch(batch, env);
    summary[env] = { products: new Set(batch.map(b => b.component)).size, points: batch.length };
  }
  return summary;
}

/**
 * Per-member VIP check [F3]:
 * For each pool member host, compare its localhost timing (agent.localhost_ms).
 * Flag "one member degraded" when one member's p95 exceeds 2× the median of the others.
 *
 * @param {Array<{ host: string, timings?: number[], p95?: number }>} poolMembers
 * @returns {{ one_member_degraded: boolean, degraded_host: string|null, member_p95: number|null, median_other_p95: number|null, ratio: number|null, reason: string|null }}
 */
function checkPoolMemberDegradation(poolMembers) {
  if (!Array.isArray(poolMembers) || poolMembers.length < 2) {
    return {
      one_member_degraded: false,
      degraded_host: null,
      member_p95: null,
      median_other_p95: null,
      ratio: null,
      reason: 'INSUFFICIENT_POOL_MEMBERS'
    };
  }

  // Calculate p95 for each member if timings array is passed
  const membersWithP95 = poolMembers.map(m => {
    let p95 = m.p95;
    if (typeof p95 !== 'number' && Array.isArray(m.timings) && m.timings.length > 0) {
      const sorted = [...m.timings].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
      p95 = sorted[idx];
    }
    return { host: m.host, p95: typeof p95 === 'number' && Number.isFinite(p95) ? p95 : null };
  }).filter(m => m.p95 !== null);

  if (membersWithP95.length < 2) {
    return {
      one_member_degraded: false,
      degraded_host: null,
      member_p95: null,
      median_other_p95: null,
      ratio: null,
      reason: 'INSUFFICIENT_VALID_METRICS'
    };
  }

  for (const candidate of membersWithP95) {
    const others = membersWithP95.filter(m => m.host !== candidate.host).map(m => m.p95);
    if (others.length === 0) continue;
    others.sort((a, b) => a - b);
    const mid = Math.floor(others.length / 2);
    const median = others.length % 2 !== 0 ? others[mid] : (others[mid - 1] + others[mid]) / 2;

    if (median > 0 && candidate.p95 > 2 * median) {
      const ratio = Math.round((candidate.p95 / median) * 100) / 100;
      return {
        one_member_degraded: true,
        degraded_host: candidate.host,
        member_p95: candidate.p95,
        median_other_p95: median,
        ratio,
        reason: `Host ${candidate.host} response time p95 (${candidate.p95}ms) exceeds 2× the median of peers (${median}ms, ratio: ${ratio}x)`
      };
    }
  }

  return {
    one_member_degraded: false,
    degraded_host: null,
    member_p95: null,
    median_other_p95: null,
    ratio: null,
    reason: null
  };
}

const POOL_MEMBERS_SQL = `SELECT component,
       entity_id,
       quantiles(0.95)(value)[1] AS p95_ms,
       count() AS sample_count
FROM metrics
WHERE env = {env:String}
  AND metric_name = 'agent.localhost_ms'
  AND ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
  AND ts < fromUnixTimestamp64Milli({until:Int64}, 'UTC')
GROUP BY component, entity_id
HAVING sample_count >= 5`;

/**
 * Runs pool member check over ClickHouse data.
 */
async function runPoolMemberCheck({ environments = ['prod', 'staging'], ch = clickhouse, nowMs = Date.now(), lookbackMinutes = 15 } = {}) {
  if (!ch.isConfigured()) {
    return { skipped: true, reason: 'ClickHouse not configured' };
  }
  const until = nowMs;
  const since = until - lookbackMinutes * 60000;
  const results = {};

  for (const env of environments) {
    const rows = await ch.query(POOL_MEMBERS_SQL, { env, since, until });
    const byProduct = new Map();
    for (const r of rows) {
      const product = r.component;
      if (!byProduct.has(product)) byProduct.set(product, []);
      byProduct.get(product).push({
        host: r.entity_id ? r.entity_id.replace(/^host:/, '') : r.component,
        p95: Number(r.p95_ms)
      });
    }

    results[env] = {};
    for (const [prod, members] of byProduct.entries()) {
      results[env][prod] = checkPoolMemberDegradation(members);
    }
  }

  return results;
}

module.exports = {
  runAviOverhead,
  OVERHEAD_SQL,
  _lastWrittenMinute: lastWrittenMinute,
  checkPoolMemberDegradation,
  runPoolMemberCheck,
  POOL_MEMBERS_SQL
};
