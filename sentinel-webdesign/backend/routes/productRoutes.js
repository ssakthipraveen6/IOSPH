/**
 * backend/routes/productRoutes.js
 *
 * Product toolchain inventory, Golden Journey metrics, execution runs,
 * and failure screenshot artifact endpoints.
 *
 * [U1] Journey telemetry is read from ClickHouse (`spans`, plus the
 * `journey.success` series through queryMetrics) rather than from the
 * in-memory history of the node that happens to run the probes, so every
 * node answers the same. p95 is computed by ClickHouse (quantile(0.95)) over
 * the requested range. With ClickHouse blank or empty the answer is
 * DATA_UNAVAILABLE with null telemetry: nothing is synthesised.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const yamlConfig = require('../config/yaml_config');
const inventory = require('@sentinel/inventory');
const db = require('@sentinel/database');
const clickhouse = require('../../database/clickhouse');

const HOUR_MS = 3600 * 1000;
const DEFAULT_RANGE_MS = 24 * HOUR_MS;
const MAX_RANGE_MS = 30 * 24 * HOUR_MS; // spans TTL (003_spans.sql)
const FAILURE_LIMIT = 10;
const TREND_STEPS = [60, 300, 900, 3600, 6 * 3600, 86400];
const TREND_TARGET_POINTS = 120;

// Environment of the request.
function requestEnv(req) {
  return req.sentinelEnv || 'staging';
}

// Application manifest by id (also with - instead of _).
function resolveApp(id) {
  return yamlConfig.getApplication(id)
    || yamlConfig.getApplication(id.replace(/-/g, '_'))
    || yamlConfig.getApplication(id.replace(/_/g, '-'))
    || null;
}

/** ISO string or epoch ms -> epoch ms; undefined when absent; NaN when unparseable. */
function parseInstant(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Range from ?from=&to= (ISO or epoch ms), or ?hours= (legacy). Default: the last 24h.
 * Returns { from, to } in epoch ms, or { error }.
 */
function parseRange(query, now = Date.now()) {
  const to = parseInstant(query.to);
  const from = parseInstant(query.from);
  if (Number.isNaN(to) || Number.isNaN(from)) return { error: 'from/to must be ISO-8601 timestamps or epoch milliseconds.' };
  const end = to === undefined ? now : to;
  let start = from;
  if (start === undefined) {
    const hours = parseInt(query.hours, 10);
    start = end - (Number.isFinite(hours) && hours > 0 ? hours * HOUR_MS : DEFAULT_RANGE_MS);
  }
  if (start >= end) return { error: '"from" must be earlier than "to".' };
  if (end - start > MAX_RANGE_MS) start = end - MAX_RANGE_MS;
  return { from: start, to: end };
}

/** Bucket width for the trend series: the smallest step giving at most ~TREND_TARGET_POINTS points. */
function trendStepSeconds(rangeMs) {
  const wanted = rangeMs / 1000 / TREND_TARGET_POINTS;
  return TREND_STEPS.find(s => s >= wanted) || TREND_STEPS[TREND_STEPS.length - 1];
}

// Number or null.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Rounded number or null.
function roundOrNull(v, digits = 0) {
  const n = num(v);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ISO date or null.
function isoOrNull(ms) {
  const n = num(ms);
  return n === null || n <= 0 ? null : new Date(n).toISOString();
}

// ok / total as a rate.
function rate(ok, total) {
  const t = num(total);
  const o = num(ok);
  if (!t || o === null) return null;
  return Math.round((o / t) * 10000) / 100;
}

// Span status as HEALTHY / FAILED.
function spanStatus(s) {
  if (s === 'OK') return 'HEALTHY';
  if (s === 'ERROR') return 'FAILED';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------- SQL
// Every value is a `{name:Type}` parameter; nothing user-supplied is interpolated.

const RANGE_WHERE = `env = {env:String}
  AND service = {service:String}
  AND start_ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
  AND start_ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')`;

/** One row: all journey root spans of the product over the range. */
const SUMMARY_SQL = `SELECT
    count() AS runs,
    countIf(status = 'ERROR') AS failures,
    quantile(0.5)(duration_ms) AS p50_ms,
    quantile(0.95)(duration_ms) AS p95_ms,
    toUnixTimestamp64Milli(max(start_ts)) AS last_run_ms
FROM {db}.spans
WHERE ${RANGE_WHERE}
  AND parent_span_id = ''`;

/** One row per journey: root spans grouped by the `journey` attribute. */
const JOURNEY_SQL = `SELECT
    attributes['journey'] AS journey_id,
    count() AS runs,
    countIf(status = 'ERROR') AS failures,
    quantile(0.5)(duration_ms) AS p50_ms,
    quantile(0.95)(duration_ms) AS p95_ms,
    toUnixTimestamp64Milli(max(start_ts)) AS last_run_ms,
    argMax(status, start_ts) AS last_status
FROM {db}.spans
WHERE ${RANGE_WHERE}
  AND parent_span_id = ''
GROUP BY journey_id`;

/** One row per (journey, step): step spans; SKIPPED steps never count towards latency or success. */
const STEP_SQL = `SELECT
    attributes['journey'] AS journey_id,
    attributes['step'] AS step_id,
    countIf(status != 'SKIPPED') AS executed,
    countIf(status = 'OK') AS ok,
    quantileIf(0.95)(duration_ms, status != 'SKIPPED') AS p95_ms
FROM {db}.spans
WHERE ${RANGE_WHERE}
  AND parent_span_id != ''
  AND attributes['step'] != ''
GROUP BY journey_id, step_id`;

/** The last failed runs: one root span per failed run, newest first. */
const FAILURES_SQL = `SELECT
    trace_id,
    name,
    attributes['journey'] AS journey_id,
    attributes['failing_step'] AS step_id,
    attributes['error'] AS error,
    duration_ms,
    toUnixTimestamp64Milli(start_ts) AS ts_ms
FROM {db}.spans
WHERE ${RANGE_WHERE}
  AND parent_span_id = ''
  AND status = 'ERROR'
ORDER BY start_ts DESC
LIMIT {limit:UInt32}`;

/** Recent runs: root spans, newest first. */
const RUNS_SQL = `SELECT
    trace_id,
    name,
    attributes['journey'] AS journey_id,
    attributes['error'] AS error,
    status,
    duration_ms,
    toUnixTimestamp64Milli(start_ts) AS ts_ms
FROM {db}.spans
WHERE ${RANGE_WHERE}
  AND parent_span_id = ''
ORDER BY start_ts DESC
LIMIT {limit:UInt32}`;

/** Step spans of the given traces, in execution order. */
const RUN_STEPS_SQL = `SELECT
    trace_id,
    attributes['step'] AS step_id,
    attributes['layer'] AS layer,
    attributes['error'] AS error,
    status,
    duration_ms,
    toUnixTimestamp64Milli(start_ts) AS ts_ms
FROM {db}.spans
WHERE env = {env:String}
  AND service = {service:String}
  AND trace_id IN {traces:Array(String)}
  AND parent_span_id != ''
ORDER BY start_ts ASC
LIMIT 10000`;

// ---------------------------------------------------------------- shaping

function stepLookup(app) {
  const names = new Map();
  for (const j of app.journeys || []) {
    for (const s of j.steps || []) names.set(`${j.id}|${s.id}`, s.name || s.id);
  }
  return names;
}

// Journey summaries for a product.
function shapeJourneys(app, journeyRows = [], stepRows = []) {
  const byJourney = new Map(journeyRows.map(r => [r.journey_id, r]));
  const bySteps = new Map(stepRows.map(r => [`${r.journey_id}|${r.step_id}`, r]));
  return (app.journeys || []).map(j => {
    const r = byJourney.get(j.id);
    return {
      id: j.id,
      name: j.name || j.id,
      tier: j.tier || 'P1',
      interval_seconds: j.interval_seconds || 60,
      timeout_seconds: j.timeout_seconds || 30,
      enabled: j.enabled !== false,
      runs: r ? num(r.runs) : null,
      failures: r ? num(r.failures) : null,
      success_rate: r ? rate(num(r.runs) - num(r.failures), r.runs) : null,
      last_run_ts: r ? isoOrNull(r.last_run_ms) : null,
      last_status: r ? spanStatus(r.last_status) : 'UNKNOWN',
      p50_latency_ms: r ? roundOrNull(r.p50_ms) : null,
      p95_latency_ms: r ? roundOrNull(r.p95_ms) : null,
      steps: (j.steps || []).map(s => {
        const sr = bySteps.get(`${j.id}|${s.id}`);
        return {
          id: s.id,
          name: s.name || s.id,
          layer: s.layer || 'app',
          type: s.type || 'http',
          runs: sr ? num(sr.executed) : null,
          p95_latency_ms: sr && num(sr.executed) ? roundOrNull(sr.p95_ms) : null,
          success_rate: sr ? rate(sr.ok, sr.executed) : null
        };
      })
    };
  });
}

// Recent journey failures.
function shapeFailures(app, rows = []) {
  const steps = stepLookup(app);
  const journeyNames = new Map((app.journeys || []).map(j => [j.id, j.name || j.id]));
  return rows.map(r => ({
    trace_id: r.trace_id,
    journey_id: r.journey_id || null,
    journey_name: journeyNames.get(r.journey_id) || r.name || r.journey_id || null,
    step_id: r.step_id || null,
    step_name: r.step_id ? (steps.get(`${r.journey_id}|${r.step_id}`) || r.step_id) : null,
    ts: isoOrNull(r.ts_ms),
    duration_ms: roundOrNull(r.duration_ms),
    error: r.error || null
  }));
}

/** queryMetrics returns one point per (bucket, entity, source); collapse to one success rate per bucket. */
function shapeTrend(points = []) {
  const buckets = new Map();
  for (const p of points) {
    const v = num(p.value);
    if (!p.timestamp || v === null) continue;
    const b = buckets.get(p.timestamp) || { sum: 0, n: 0 };
    b.sum += v;
    b.n += 1;
    buckets.set(p.timestamp, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, b]) => ({ ts, success_rate: Math.round((b.sum / b.n) * 10000) / 100 }));
}

// Summary with every value null.
function emptySummary() {
  return { runs: null, failures: null, success_rate: null, p50_ms: null, p95_ms: null, last_run_ts: null };
}

/**
 * GET /api/products
 * Lists all toolchain products with inventory version, open alerts, and journey count.
 */
router.get('/', async (req, res) => {
  try {
    const env = requestEnv(req);
    const appsMap = yamlConfig.loadAllApplications() || {};
    const alerts = db.getAlerts ? db.getAlerts(env) : [];

    const products = [];
    for (const [appId, app] of Object.entries(appsMap)) {
      if (!app) continue;
      const canonicalId = app.id || appId;

      // Lookup inventory entity
      let entity = null;
      try {
        entity = await inventory.getEntityById(`app:${canonicalId}`);
        if (!entity) entity = await inventory.getEntityById(canonicalId);
      } catch (_) {}

      const productVersion = entity?.labels?.version || null;
      const appAlerts = alerts.filter(a => a.component === canonicalId || a.component === app.name);

      products.push({
        id: canonicalId,
        name: app.name || canonicalId,
        tier: app.tier || 'TIER_1',
        version: productVersion,
        alert_count: appAlerts.length,
        journeys_count: Array.isArray(app.journeys) ? app.journeys.length : 0,
        enabled: app.enabled !== false,
        jvm: app.jvm || null,
        jvm_jmx_port: app.jvm?.jmx_port || app.jmx_port || null,
        has_jvm: Boolean(app.jvm || app.jmx_port || (app.metrics && app.metrics.health_thresholds && app.metrics.health_thresholds.jvm_heap_warning_pct))
      });
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: `Failed to load products: ${err.message}` });
  }
});

/**
 * GET /api/products/:id/journeys?environment=&from=&to=   (or legacy &hours=)
 * Manifest journey definitions enriched with span telemetry from ClickHouse
 * over the range, the product-level summary, the last 10 failed runs and a
 * success-rate trend (journey.success via queryMetrics with stepSeconds).
 */
router.get('/:id/journeys', async (req, res) => {
  const id = req.params.id;
  const env = requestEnv(req);
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  let app;
  try {
    app = resolveApp(id);
  } catch (err) {
    return res.status(500).json({ error: `Failed to load journeys for product: ${err.message}` });
  }
  if (!app) {
    return res.status(404).json({ error: `Product "${id}" not found in manifest catalog.` });
  }

  const productId = app.id || id;
  const stepSeconds = trendStepSeconds(range.to - range.from);
  const base = {
    product_id: productId,
    environment: env,
    source: 'clickhouse',
    range: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
  };
  const unavailable = (reason) => res.json({
    status: 'DATA_UNAVAILABLE',
    reason,
    ...base,
    summary: emptySummary(),
    journeys: shapeJourneys(app),
    failures: [],
    trend: { metric: 'journey.success', step_seconds: stepSeconds, points: [] },
    timestamp: new Date().toISOString()
  });

  if (!clickhouse.isConfigured()) {
    return unavailable('ClickHouse is not configured, so no journey spans are stored.');
  }

  const params = { env, service: productId, from: range.from, to: range.to };
  let summaryRows, journeyRows, stepRows, failureRows;
  try {
    [summaryRows, journeyRows, stepRows, failureRows] = await Promise.all([
      clickhouse.query(SUMMARY_SQL, params),
      clickhouse.query(JOURNEY_SQL, params),
      clickhouse.query(STEP_SQL, params),
      clickhouse.query(FAILURES_SQL, { ...params, limit: FAILURE_LIMIT })
    ]);
  } catch (err) {
    return unavailable(`Failed to query journey spans: ${err.message}`);
  }

  const s = summaryRows[0] || {};
  const runs = num(s.runs) || 0;
  if (runs === 0) {
    return unavailable(`No journey spans stored for ${productId} in ${env} between ${base.range.from} and ${base.range.to}.`);
  }

  // The trend is secondary: a missing rollup must not hide the span data.
  let trendPoints = [];
  let trendReason;
  try {
    trendPoints = shapeTrend(await clickhouse.queryMetrics({
      component: productId,
      metricName: 'journey.success',
      env,
      sinceMs: range.from,
      untilMs: range.to,
      stepSeconds
    }));
  } catch (err) {
    trendReason = `Failed to query journey.success: ${err.message}`;
  }

  const failures = num(s.failures) || 0;
  return res.json({
    ...base,
    summary: {
      runs,
      failures,
      success_rate: rate(runs - failures, runs),
      p50_ms: roundOrNull(s.p50_ms),
      p95_ms: roundOrNull(s.p95_ms),
      last_run_ts: isoOrNull(s.last_run_ms)
    },
    journeys: shapeJourneys(app, journeyRows, stepRows),
    failures: shapeFailures(app, failureRows),
    trend: {
      metric: 'journey.success',
      step_seconds: stepSeconds,
      points: trendPoints,
      ...(trendReason ? { status: 'DATA_UNAVAILABLE', reason: trendReason } : {})
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/products/:id/runs?environment=&limit=&from=&to=
 * Recent journey executions (root spans) with their step spans, from ClickHouse.
 */
router.get('/:id/runs', async (req, res) => {
  const id = req.params.id;
  const env = requestEnv(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  let app;
  try {
    app = resolveApp(id);
  } catch (_) {
    app = null;
  }
  const productId = (app && app.id) || id;
  const unavailable = (reason) => res.json({
    status: 'DATA_UNAVAILABLE',
    reason,
    product_id: productId,
    environment: env,
    count: 0,
    runs: []
  });

  if (!clickhouse.isConfigured()) {
    return unavailable('ClickHouse is not configured, so no journey spans are stored.');
  }

  try {
    const params = { env, service: productId, from: range.from, to: range.to };
    const roots = await clickhouse.query(RUNS_SQL, { ...params, limit });
    if (roots.length === 0) {
      return unavailable(`No journey runs stored for ${productId} in ${env} in the requested range.`);
    }
    const stepRows = await clickhouse.query(RUN_STEPS_SQL, {
      env, service: productId, traces: roots.map(r => String(r.trace_id))
    });
    const stepsByTrace = new Map();
    for (const st of stepRows) {
      if (!stepsByTrace.has(st.trace_id)) stepsByTrace.set(st.trace_id, []);
      stepsByTrace.get(st.trace_id).push(st);
    }

    const names = app ? stepLookup(app) : new Map();
    const journeyNames = new Map(((app && app.journeys) || []).map(j => [j.id, j.name || j.id]));
    const baseDir = path.resolve(__dirname, '../../.runtime/journeys');
    const safeId = /^[a-zA-Z0-9_-]+$/;

    const runs = roots.map(r => ({
      run_id: r.trace_id,
      journey_id: r.journey_id || null,
      journey_name: journeyNames.get(r.journey_id) || r.name || r.journey_id || null,
      environment: env,
      start_ts: isoOrNull(r.ts_ms),
      duration_ms: roundOrNull(r.duration_ms),
      status: r.status === 'OK' ? 'PASSED' : 'FAILED',
      error: r.error || null,
      steps: (stepsByTrace.get(r.trace_id) || []).map(st => {
        // Screenshots are written by the node that ran the probe; offered only when present here.
        const hasScreenshot = safeId.test(String(r.trace_id)) && safeId.test(String(st.step_id))
          && fs.existsSync(path.resolve(baseDir, String(r.trace_id), `${st.step_id}.png`));
        return {
          step_id: st.step_id,
          name: names.get(`${r.journey_id}|${st.step_id}`) || st.step_id,
          layer: st.layer || 'app',
          duration_ms: roundOrNull(st.duration_ms),
          status: st.status === 'OK' ? 'PASSED' : (st.status || 'UNKNOWN'),
          error: st.error || null,
          screenshot_url: hasScreenshot ? `/api/journeys/screenshot/${r.trace_id}/${st.step_id}` : null
        };
      })
    }));

    res.json({ product_id: productId, environment: env, count: runs.length, runs });
  } catch (err) {
    return unavailable(`Failed to query journey runs: ${err.message}`);
  }
});

/**
 * GET /api/journeys/screenshot/:traceId/:stepId
 * Serves failure screenshot PNG with strict path validation and traversal prevention.
 */
router.get('/screenshot/:traceId/:stepId', (req, res) => {
  const { traceId, stepId } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(traceId) || !/^[a-zA-Z0-9_-]+$/.test(stepId)) {
    return res.status(400).json({ error: 'Invalid traceId or stepId identifier format.' });
  }

  const baseDir = path.resolve(__dirname, '../../.runtime/journeys');
  const targetPath = path.resolve(baseDir, traceId, `${stepId}.png`);

  if (!targetPath.startsWith(baseDir)) {
    return res.status(403).json({ error: 'Path traversal forbidden.' });
  }

  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Screenshot artifact not found.' });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(targetPath).pipe(res);
});

module.exports = router;
module.exports._internals = { parseRange, trendStepSeconds, SUMMARY_SQL, JOURNEY_SQL, STEP_SQL, FAILURES_SQL };
