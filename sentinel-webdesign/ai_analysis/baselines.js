/**
 * ai_analysis/baselines.js
 *
 * M5 Task 5.1: Hour-of-Week Baselines Engine
 * Computes and tracks median and MAD (Median Absolute Deviation) per
 * (env, entity, metric, hour-of-week 0..167) over a 4-week lookback window.
 * Anomaly detection uses robust z-score:
 *   robust_z = |x - median| / (1.4826 * (mad || 1e-4))
 */

const crypto = require('crypto');

let clickhouse = null;
try {
  clickhouse = require('@sentinel/database/clickhouse');
} catch (_) {
  try {
    clickhouse = require('../database/clickhouse');
  } catch (e) {
    clickhouse = null;
  }
}

let leaderLock = null;
try {
  leaderLock = require('@sentinel/database/leader_lock');
} catch (_) {
  try {
    leaderLock = require('../database/leader_lock');
  } catch (e) {
    leaderLock = null;
  }
}

// In-memory cache: `${env}:${entityId}:${metricName}:${hourOfWeek}` -> { median, mad, sampleCount, updated_at }
const inMemoryBaselines = new Map();

// Consecutive violations tracker: `${env}:${entityId}:${metricName}` -> count
const consecutiveViolations = new Map();

/**
 * Returns hour of week in range [0..167]
 * 0 = Sunday 00:00, 167 = Saturday 23:00
 */
function getHourOfWeek(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

/**
 * Calculate median of a number array
 */
function calculateMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calculate Median Absolute Deviation (MAD)
 */
function calculateMad(values, median = null) {
  if (!values || values.length <= 1) return 0;
  const med = median !== null ? median : calculateMedian(values);
  const deviations = values.map(v => Math.abs(v - med));
  return calculateMedian(deviations);
}

/**
 * Set baseline explicitly (used by ingestion, sync, or test fixtures)
 */
function setBaseline(env, entityId, metricName, hourOfWeek, median, mad, sampleCount = 30) {
  const key = `${env}:${entityId}:${metricName}:${hourOfWeek}`;
  const record = {
    env,
    entityId,
    metricName,
    hourOfWeek,
    median: Number(median),
    mad: Number(mad),
    sampleCount: Number(sampleCount),
    updated_at: new Date().toISOString()
  };
  inMemoryBaselines.set(key, record);
  return record;
}

/**
 * Get baseline for given metric at specific time
 */
function getBaseline(env, entityId, metricName, date = new Date()) {
  const hourOfWeek = getHourOfWeek(date);
  const key = `${env}:${entityId}:${metricName}:${hourOfWeek}`;
  return inMemoryBaselines.get(key) || null;
}

/**
 * Score a metric observation against hour-of-week baseline
 * @param {Object} opts
 * @param {string} opts.env
 * @param {string} opts.entityId
 * @param {string} opts.metricName
 * @param {number} opts.value
 * @param {Date} [opts.timestamp]
 * @param {number} [opts.zThreshold=3.0]
 * @param {number} [opts.consecutiveN=3]
 * @returns {Object} score result
 */
function scoreObservation({
  env = 'staging',
  entityId,
  metricName,
  value,
  timestamp = new Date(),
  zThreshold = 3.0,
  consecutiveN = 3
}) {
  if (typeof value !== 'number' || isNaN(value)) return null;

  const hourOfWeek = getHourOfWeek(timestamp);
  const baseline = getBaseline(env, entityId, metricName, timestamp);
  const violationKey = `${env}:${entityId}:${metricName}`;

  if (!baseline || baseline.sampleCount < 5) {
    // Insufficient historical baseline data for this specific hour of week
    consecutiveViolations.set(violationKey, 0);
    return {
      evaluated: false,
      reason: 'INSUFFICIENT_BASELINE_SAMPLES',
      value,
      hourOfWeek
    };
  }

  const { median, mad } = baseline;
  // Robust Z calculation using 1.4826 scale factor for normal distribution
  const scale = 1.4826 * (mad > 1e-4 ? mad : 1e-4);
  const robustZ = Math.abs(value - median) / scale;

  let currentStreak = consecutiveViolations.get(violationKey) || 0;
  const isViolation = robustZ >= zThreshold;

  if (isViolation) {
    currentStreak += 1;
  } else {
    currentStreak = 0;
  }
  consecutiveViolations.set(violationKey, currentStreak);

  const isAnomaly = isViolation && currentStreak >= consecutiveN;

  return {
    evaluated: true,
    env,
    entityId,
    metricName,
    value,
    hourOfWeek,
    median: parseFloat(median.toFixed(2)),
    mad: parseFloat(mad.toFixed(2)),
    robustZ: parseFloat(robustZ.toFixed(2)),
    threshold: zThreshold,
    consecutiveViolations: currentStreak,
    requiredConsecutive: consecutiveN,
    isAnomaly
  };
}

/**
 * Hour-of-week in SQL, same convention as getHourOfWeek(): 0 = Sunday 00:00 UTC.
 * ClickHouse toDayOfWeek() is Monday=1..Sunday=7, so `% 7` maps Sunday to 0.
 */
const SQL_HOUR_OF_WEEK = "(toDayOfWeek(ts) % 7) * 24 + toHour(ts)";

/**
 * Baseline rollup SQL. MAD needs the median first, so it is computed in two steps:
 * the inner query joins every point to its group's median, the outer one takes the
 * median of the absolute deviations.
 */
const BASELINE_ROLLUP_SQL = `SELECT p.env AS env, p.entity_id AS entity_id, p.metric_name AS metric_name, p.hour_of_week AS hour_of_week,
       any(m.median) AS median,
       quantile(0.5)(abs(p.value - m.median)) AS mad,
       count() AS sample_count
FROM
(
    SELECT env, entity_id, metric_name, ${SQL_HOUR_OF_WEEK} AS hour_of_week, value
    FROM metrics
    WHERE ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
) AS p
INNER JOIN
(
    SELECT env, entity_id, metric_name, ${SQL_HOUR_OF_WEEK} AS hour_of_week, quantile(0.5)(value) AS median
    FROM metrics
    WHERE ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
    GROUP BY env, entity_id, metric_name, hour_of_week
) AS m
ON p.env = m.env AND p.entity_id = m.entity_id AND p.metric_name = m.metric_name AND p.hour_of_week = m.hour_of_week
GROUP BY env, entity_id, metric_name, hour_of_week
HAVING sample_count >= 5`;

const LOAD_BASELINES_SQL = `SELECT env, entity_id, metric_name, hour_of_week, median, mad, sample_count
FROM baselines FINAL`;

/**
 * Leader-only hourly rollup (P3): computes hour-of-week median/MAD from ClickHouse
 * metrics, persists them to the `baselines` table and refreshes the in-memory cache.
 */
async function computeBaselinesFromClickHouse(lookbackDays = 28, { nowMs = Date.now(), skipLeaderCheck = false } = {}) {
  if (!skipLeaderCheck && leaderLock && !leaderLock.isLeader()) {
    return { status: 'SKIPPED', reason: 'Non-leader node' };
  }
  if (!clickhouse || !clickhouse.isConfigured()) {
    return { status: 'SKIPPED', reason: 'ClickHouse not configured' };
  }

  const since = nowMs - lookbackDays * 86400 * 1000;
  const rows = await clickhouse.query(BASELINE_ROLLUP_SQL, { since });
  const updatedAt = new Date(nowMs).toISOString();
  const persisted = [];
  for (const r of rows) {
    setBaseline(r.env, r.entity_id, r.metric_name, Number(r.hour_of_week), Number(r.median), Number(r.mad), Number(r.sample_count));
    persisted.push({
      env: r.env,
      entity_id: r.entity_id,
      metric_name: r.metric_name,
      hour_of_week: Number(r.hour_of_week),
      median: Number(r.median),
      mad: Number(r.mad),
      sample_count: Number(r.sample_count),
      updated_at: updatedAt.replace('T', ' ').replace('Z', '')
    });
  }
  if (persisted.length > 0) {
    await clickhouse.insertRows('baselines', persisted);
  }
  return { status: 'SUCCESS', updatedBaselines: persisted.length };
}

/**
 * Loads persisted baselines into memory (called once at start-up on every node),
 * so a restarted or follower node scores observations without waiting an hour.
 */
async function loadBaselinesFromClickHouse() {
  if (!clickhouse || !clickhouse.isConfigured()) {
    return { status: 'SKIPPED', reason: 'ClickHouse not configured' };
  }
  const rows = await clickhouse.query(LOAD_BASELINES_SQL);
  for (const r of rows) {
    setBaseline(r.env, r.entity_id, r.metric_name, Number(r.hour_of_week), Number(r.median), Number(r.mad), Number(r.sample_count));
  }
  return { status: 'SUCCESS', loaded: rows.length };
}

module.exports = {
  getHourOfWeek,
  calculateMedian,
  calculateMad,
  setBaseline,
  getBaseline,
  scoreObservation,
  computeBaselinesFromClickHouse,
  loadBaselinesFromClickHouse,
  BASELINE_ROLLUP_SQL,
  LOAD_BASELINES_SQL,
  inMemoryBaselines
};
