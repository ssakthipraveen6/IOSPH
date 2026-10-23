/**
 * backend/jobs/change_points.js — P4
 *
 * Every 15 minutes: CUSUM change-point scan over the last 24 h of
 *  - journey step p95 (`journey.step.duration_ms`, per product + step), and
 *  - key product metrics (`vip.total_ms`, `agent.localhost_ms`, `avi.overhead_ms`),
 * bucketed into 15-minute p95 points from ClickHouse. A detected step change is
 * written to `change_points` and linked to version_change / file_change events
 * recorded within an hour of it. The same change is recorded only once.
 */

const clickhouse = require('../../database/clickhouse');
const eventStore = require('../../database/event_store');
const changePoints = require('../../ai_analysis/change_points');

const KEY_METRICS = ['vip.total_ms', 'agent.localhost_ms', 'avi.overhead_ms'];
const recorded = new Map(); // `${env}|${entity}|${series}` -> last recorded change timestamp

const SERIES_SQL = `SELECT component,
       if(metric_name = 'journey.step.duration_ms', concat('journey.step.p95:', attributes['journey'], ':', attributes['step']), concat(metric_name, ':p95')) AS series,
       toUnixTimestamp64Milli(toDateTime64(toStartOfInterval(ts, toIntervalMinute({bucket:UInt32})), 3, 'UTC')) AS bucket_ms,
       quantile(0.95)(value) AS p95
FROM metrics
WHERE env = {env:String}
  AND metric_name IN {metrics:Array(String)}
  AND ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
  AND ts < fromUnixTimestamp64Milli({until:Int64}, 'UTC')
GROUP BY component, series, bucket_ms
ORDER BY component, series, bucket_ms`;

// Looks for sudden level changes in key metric series (ClickHouse) and records them as events.
async function runChangePointScan({
  environments = ['prod', 'staging'],
  ch = clickhouse,
  events = eventStore,
  detector = changePoints,
  nowMs = Date.now(),
  windowHours = 24,
  bucketMinutes = 15
} = {}) {
  if (!ch.isConfigured()) {
    return { skipped: true, reason: 'ClickHouse not configured (change points need metric history)' };
  }
  const since = nowMs - windowHours * 3600 * 1000;
  const summary = {};

  for (const env of environments) {
    const rows = await ch.query(SERIES_SQL, {
      env,
      bucket: bucketMinutes,
      metrics: ['journey.step.duration_ms', ...KEY_METRICS],
      since,
      until: nowMs
    });

    const seriesMap = new Map();
    for (const r of rows) {
      const key = `${r.component}|${r.series}`;
      if (!seriesMap.has(key)) seriesMap.set(key, { component: r.component, series: r.series, points: [] });
      seriesMap.get(key).points.push({ value: Number(r.p95), timestamp: new Date(Number(r.bucket_ms)).toISOString() });
    }

    let changeEvents = [];
    try {
      const all = await events.getEvents({ from: new Date(since).toISOString(), to: new Date(nowMs).toISOString(), environment: env, limit: 1000 });
      changeEvents = (all || []).filter(e => e.kind === 'version_change' || e.kind === 'file_change');
    } catch (_) {
      changeEvents = [];
    }

    let found = 0;
    for (const s of seriesMap.values()) {
      const entityId = `app:${s.component}`;
      const relatedEvents = changeEvents.filter(e => !e.entity_id || e.entity_id === entityId || (e.payload && e.payload.product === s.component));
      const preview = detector.detectChangePoint(s.points);
      if (!preview) continue;
      const dedupeKey = `${env}|${entityId}|${s.series}`;
      if (recorded.get(dedupeKey) === preview.timestamp) continue;
      const cp = await detector.recordChangePoint({ env, entityId, series: s.series, points: s.points, events: relatedEvents });
      if (cp) {
        recorded.set(dedupeKey, cp.timestamp);
        found++;
      }
    }
    summary[env] = { series: seriesMap.size, change_points: found };
  }
  return summary;
}

module.exports = { runChangePointScan, SERIES_SQL, _recorded: recorded };
