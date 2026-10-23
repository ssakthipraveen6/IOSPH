/**
 * ai_analysis/change_points.js
 *
 * M5 Task 5.2: Change-Point Detection Engine (CUSUM)
 * Detects structural step-changes in journey step p95 timings and key metrics.
 * Produces change_points records:
 *   direction: 'worsened' | 'improved'
 *   magnitude_pct: percentage change from before to after
 *   before, after: baseline values before and after change point
 *   linked_events: correlated version_change / file_change within window
 */

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

/**
 * Standard CUSUM (Cumulative Sum) step-change detector
 * @param {Array<number|{value: number, timestamp: string|number}>} points
 * @param {Object} [options]
 * @param {number} [options.thresholdSigma=3.0] Decision threshold h in units of stddev
 * @param {number} [options.slackSigma=0.5] Slack parameter k in units of stddev
 * @param {number} [options.minSegmentLength=5] Minimum points required before change point
 * @param {boolean} [options.lowerIsBetter=true] Latency/error rate (lower=better) vs throughput
 * @returns {Object|null} Detected change point or null if no significant step
 */
function detectChangePoint(points, options = {}) {
  if (!Array.isArray(points) || points.length < 10) return null;

  const rawValues = points.map(p => (typeof p === 'number' ? p : p.value));
  const timestamps = points.map(p => (typeof p === 'number' ? null : p.timestamp));

  const minSegment = options.minSegmentLength || 5;
  const lowerIsBetter = options.lowerIsBetter !== false;

  // Use the initial baseline segment to calculate reference mean and stddev
  const initSegment = rawValues.slice(0, Math.max(minSegment, Math.floor(rawValues.length / 3)));
  const mean = initSegment.reduce((a, b) => a + b, 0) / initSegment.length;
  const variance = initSegment.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / initSegment.length;
  const stddev = Math.sqrt(variance) || 1.0;

  const k = (options.slackSigma || 0.5) * stddev;
  const h = (options.thresholdSigma || 3.0) * stddev;

  let sPos = 0;
  let sNeg = 0;
  let changeIdx = -1;
  let detectedType = null;

  for (let i = 0; i < rawValues.length; i++) {
    const val = rawValues[i];
    sPos = Math.max(0, sPos + (val - mean) - k);
    sNeg = Math.max(0, sNeg - (val - mean) - k);

    if (sPos > h) {
      changeIdx = i;
      detectedType = 'increase';
      break;
    }
    if (sNeg > h) {
      changeIdx = i;
      detectedType = 'decrease';
      break;
    }
  }

  if (changeIdx === -1 || changeIdx < minSegment || changeIdx >= rawValues.length - 2) {
    return null; // Noise or insufficient boundary margin
  }

  // Calculate before and after averages
  const beforeSlice = rawValues.slice(0, changeIdx);
  const afterSlice = rawValues.slice(changeIdx);

  const beforeVal = beforeSlice.reduce((a, b) => a + b, 0) / beforeSlice.length;
  const afterVal = afterSlice.reduce((a, b) => a + b, 0) / afterSlice.length;

  const magnitudePct = parseFloat((((afterVal - beforeVal) / (beforeVal || 1.0)) * 100).toFixed(2));

  // Determine direction based on metric semantics
  let direction;
  if (lowerIsBetter) {
    direction = magnitudePct > 0 ? 'worsened' : 'improved';
  } else {
    direction = magnitudePct > 0 ? 'improved' : 'worsened';
  }

  const changeTimestamp = timestamps[changeIdx] || new Date().toISOString();

  return {
    index: changeIdx,
    timestamp: changeTimestamp,
    before: parseFloat(beforeVal.toFixed(2)),
    after: parseFloat(afterVal.toFixed(2)),
    magnitude_pct: Math.abs(magnitudePct),
    raw_delta_pct: magnitudePct,
    direction,
    method: 'cusum'
  };
}

/**
 * Correlates detected change point against nearby events (e.g. version_change, file_change)
 */
function correlateEvents(changeTimestamp, events = [], windowMinutes = 60) {
  if (!events || !Array.isArray(events) || events.length === 0) return [];
  const targetTs = new Date(changeTimestamp).getTime();
  const windowMs = windowMinutes * 60 * 1000;

  return events.filter(evt => {
    const evtTs = new Date(evt.ts || evt.timestamp || 0).getTime();
    const diff = Math.abs(targetTs - evtTs);
    return diff <= windowMs && (evt.kind === 'version_change' || evt.kind === 'file_change');
  });
}

/**
 * Complete analysis pipeline: Detects change-point, correlates events, and saves to ClickHouse
 */
async function recordChangePoint({
  env = 'staging',
  entityId,
  series,
  points,
  events = [],
  options = {}
}) {
  const result = detectChangePoint(points, options);
  if (!result) return null;

  const linkedEvents = correlateEvents(result.timestamp, events);
  result.linked_events = linkedEvents;

  // Persist to ClickHouse change_points table if available
  if (clickhouse && clickhouse.isConfigured && clickhouse.isConfigured()) {
    try {
      const sql = `
        INSERT INTO {db}.change_points (ts, env, entity_id, series, direction, magnitude_pct, before, after, method)
        VALUES ({ts:DateTime64(3, 'UTC')}, {env:String}, {entity_id:String}, {series:String}, {direction:String}, {magnitude_pct:Float64}, {before:Float64}, {after:Float64}, {method:String})
      `;
      await clickhouse.command(sql, {
        ts: result.timestamp,
        env,
        entity_id: entityId,
        series,
        direction: result.direction,
        magnitude_pct: result.magnitude_pct,
        before: result.before,
        after: result.after,
        method: result.method
      });
    } catch (err) {
      console.warn('[CHANGE_POINTS] change_points insert failed:', err.message);
    }
  }

  return {
    env,
    entity_id: entityId,
    series,
    ...result
  };
}

module.exports = {
  detectChangePoint,
  correlateEvents,
  recordChangePoint
};
