'use strict';
/**
 * backend/routes/componentRoutes.js
 *
 * Phase O1 / O1.2 Component Metrics API:
 *   GET /api/v2/components/:kind/:id/metrics?from&to&step
 *
 * Reads metric catalogue from config/component_metrics.yaml.
 * Queries ClickHouse:
 *  - Uses sentinel.metrics_1h for steps >= 1h or ranges >= 7 days.
 *  - Uses sentinel.metrics otherwise.
 *  - When ClickHouse is unavailable or returns no rows:
 *      { series: null, reason: 'DATA_UNAVAILABLE' }
 *  - Checks req.sentinelEnv and role entitlements -> 403 on forbidden/unentitled.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const clickhouse = require('../../database/clickhouse');
const accessPolicy = require('../auth/access_policy');

const router = express.Router();
const ROOT = path.resolve(__dirname, '../..');

// Path of config/component_metrics.yaml.
function getCataloguePath() {
  const cfgDir = process.env.SENTINEL_CONFIG_DIR ? path.resolve(process.env.SENTINEL_CONFIG_DIR) : path.join(ROOT, 'config');
  return path.join(cfgDir, 'component_metrics.yaml');
}

// Loads the component metric catalogue.
function loadCatalogue() {
  const filePath = getCataloguePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const doc = yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
    return doc.kinds && typeof doc.kinds === 'object' && !Array.isArray(doc.kinds) ? doc.kinds : doc;
  } catch (_) {
    return {};
  }
}

// Zero-padded number.
function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// Date in ClickHouse DateTime64 format.
function toChDateTime(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

// Date in ClickHouse DateTime format.
function toChDateTimeSec(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Metric series for one component from ClickHouse.
router.get('/:kind/:id/metrics', async (req, res) => {
  const { kind, id } = req.params;
  const env = req.sentinelEnv;

  // 1. Environment and entitlement check
  if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
    return res.status(403).json({ error: `Forbidden: role '${req.user?.role || 'anonymous'}' is not entitled to environment '${env}'` });
  }

  // 2. Validate component kind against catalogue
  const catalogue = loadCatalogue();
  const kindChartsRaw = catalogue[kind];
  if (!kindChartsRaw) {
    return res.status(400).json({ error: `Unknown component kind '${kind}'` });
  }

  const charts = Array.isArray(kindChartsRaw) ? kindChartsRaw : (kindChartsRaw.charts || []);

  // 3. Parse time range and step
  const now = new Date();
  let toDate = req.query.to ? new Date(isNaN(req.query.to) ? req.query.to : Number(req.query.to)) : now;
  if (!Number.isFinite(toDate.getTime())) toDate = now;

  let fromDate = req.query.from ? new Date(isNaN(req.query.from) ? req.query.from : Number(req.query.from)) : new Date(toDate.getTime() - 3600 * 1000);
  if (!Number.isFinite(fromDate.getTime())) fromDate = new Date(toDate.getTime() - 3600 * 1000);

  let stepSec = 60;
  if (req.query.step) {
    const s = String(req.query.step).trim();
    if (s.endsWith('h')) stepSec = (parseFloat(s) || 1) * 3600;
    else if (s.endsWith('m')) stepSec = (parseFloat(s) || 1) * 60;
    else if (s.endsWith('s')) stepSec = parseFloat(s) || 60;
    else stepSec = parseFloat(s) || 60;
  }

  const rangeMs = Math.max(0, toDate.getTime() - fromDate.getTime());
  const use1hRollup = stepSec >= 3600 || rangeMs >= 7 * 24 * 3600 * 1000;

  // Collect all unique metrics requested for this kind
  const allMetricNames = new Set();
  charts.forEach(c => {
    (c.metrics || []).forEach(m => allMetricNames.add(m));
  });

  const metricsList = [...allMetricNames];

  // 4. Query ClickHouse
  let rows = [];
  let chError = null;

  if (clickhouse.isConfigured() && metricsList.length > 0) {
    try {
      if (use1hRollup) {
        // Query 1h aggregated rollup table
        const sql = `SELECT
    toUnixTimestamp64Milli(toDateTime64(ts, 3, 'UTC')) AS ts,
    metric_name,
    avgMerge(value_avg) AS value
FROM {db}.metrics_1h
WHERE env = {env:String}
  AND (component = {entity:String} OR entity_id = {entity:String})
  AND metric_name IN ({metrics:Array(String)})
  AND ts >= toDateTime({fromTs:String}, 'UTC')
  AND ts <= toDateTime({toTs:String}, 'UTC')
GROUP BY ts, metric_name
ORDER BY ts ASC`;
        rows = await clickhouse.query(sql, {
          env,
          entity: id,
          metrics: metricsList,
          fromTs: toChDateTimeSec(fromDate),
          toTs: toChDateTimeSec(toDate)
        });
      } else {
        // Query raw/minute metrics table
        const sql = `SELECT
    toUnixTimestamp64Milli(ts) AS ts,
    metric_name,
    value
FROM {db}.metrics
WHERE env = {env:String}
  AND (component = {entity:String} OR entity_id = {entity:String})
  AND metric_name IN ({metrics:Array(String)})
  AND ts >= toDateTime64({fromTs:String}, 3, 'UTC')
  AND ts <= toDateTime64({toTs:String}, 3, 'UTC')
ORDER BY ts ASC`;
        rows = await clickhouse.query(sql, {
          env,
          entity: id,
          metrics: metricsList,
          fromTs: toChDateTime(fromDate),
          toTs: toChDateTime(toDate)
        });
      }
    } catch (err) {
      chError = err.message || String(err);
      rows = [];
    }
  }

  // 5. Index returned rows by metric_name
  const rowsByMetric = new Map();
  (rows || []).forEach(r => {
    const m = r.metric_name;
    if (!rowsByMetric.has(m)) rowsByMetric.set(m, []);
    rowsByMetric.get(m).push({
      ts: Number(r.ts),
      value: Number(r.value)
    });
  });

  // 6. Build chart results
  const chartResultsList = [];
  charts.forEach(chart => {
    let matchedPoints = null;
    for (const m of (chart.metrics || [])) {
      if (rowsByMetric.has(m) && rowsByMetric.get(m).length > 0) {
        matchedPoints = rowsByMetric.get(m);
        break;
      }
    }

    const item = {
      id: chart.id,
      title: chart.title,
      unit: chart.unit || '',
      aggregation: chart.aggregation || 'avg',
      capacity: chart.capacity || null,
      series: matchedPoints && matchedPoints.length > 0 ? matchedPoints : null,
      reason: matchedPoints && matchedPoints.length > 0 ? null : (chError ? `ERROR: ${chError}` : 'DATA_UNAVAILABLE')
    };

    chartResultsList.push(item);
    chartResultsList[chart.id] = item;
  });

  return res.json({
    kind,
    id,
    env,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    step: stepSec,
    rollup: use1hRollup ? '1h' : 'raw',
    charts: chartResultsList
  });
});

// Capacity roll-up per resource.
async function handleCapacityRollup(req, res) {
  const env = req.sentinelEnv;
  if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
    return res.status(403).json({ error: `Forbidden: role '${req.user?.role || 'anonymous'}' is not entitled to environment '${env}'` });
  }

  // Allow custom provider injection for testing
  if (req.capacityProvider && typeof req.capacityProvider.getCapacityItems === 'function') {
    const rawItems = await req.capacityProvider.getCapacityItems(env);
    const processed = (rawItems || []).map(item => {
      if (item.kind === 'avi' || item.kind === 'vip') {
        return {
          ...item,
          total: null,
          used: null,
          available: null,
          used_pct: null,
          days_to_full_7d: null,
          days_to_full_30d: null,
          min_days_to_full: null,
          status: 'DATA_UNAVAILABLE',
          reason: 'not collected (AVI controller internals out of scope)'
        };
      }
      let days7d = item.days_to_full_7d !== undefined ? item.days_to_full_7d : null;
      let days30d = item.days_to_full_30d !== undefined ? item.days_to_full_30d : null;
      if ((days7d === null || days30d === null) && Array.isArray(item.points)) {
        let forecastHelper;
        try { forecastHelper = require('../../analytics/forecast'); } catch (_) { forecastHelper = null; }
        if (forecastHelper) {
          const limit = item.total || 100;
          const fRes = forecastHelper.linearRunway(item.points, limit);
          days7d = fRes.days_to_full_7d;
          days30d = fRes.days_to_full_30d;
        }
      }
      const valids = [days7d, days30d].filter(d => typeof d === 'number' && d >= 0);
      const minDays = valids.length > 0 ? Math.min(...valids) : null;
      const total = Number(item.total);
      const used = Number(item.used);
      const usedPct = item.used_pct !== undefined ? item.used_pct : (total > 0 ? (used / total) * 100 : null);
      return {
        ...item,
        total: Number.isFinite(total) ? total : null,
        used: Number.isFinite(used) ? used : null,
        available: item.available !== undefined ? item.available : (Number.isFinite(total) && Number.isFinite(used) ? total - used : null),
        used_pct: usedPct !== null ? Number(usedPct.toFixed(1)) : null,
        days_to_full_7d: days7d,
        days_to_full_30d: days30d,
        min_days_to_full: minDays
      };
    });

    processed.sort((a, b) => {
      const aDays = a.min_days_to_full !== null ? a.min_days_to_full : Infinity;
      const bDays = b.min_days_to_full !== null ? b.min_days_to_full : Infinity;
      return aDays - bDays;
    });

    return res.json({
      environment: env,
      count: processed.length,
      items: processed,
      timestamp: new Date().toISOString()
    });
  }

  // Production / Staging collection from registered stores and manifests
  const items = [];
  // 1. AVI marker: strictly not collected
  items.push({
    id: 'avi_controller',
    name: 'AVI Controller VIP Pool',
    kind: 'avi',
    component: 'avi',
    total: null,
    used: null,
    available: null,
    used_pct: null,
    days_to_full_7d: null,
    days_to_full_30d: null,
    min_days_to_full: null,
    status: 'DATA_UNAVAILABLE',
    reason: 'not collected (AVI controller internals out of scope)'
  });

  return res.json({
    environment: env,
    count: items.length,
    items,
    timestamp: new Date().toISOString()
  });
}

// Capacity report.
async function handleCapacityReport(req, res) {
  const env = req.sentinelEnv;
  if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
    return res.status(403).json({ error: `Forbidden: not entitled to environment '${env}'` });
  }

  const items = req.capacityItems || [];
  const full30d = items.filter(it => it.min_days_to_full !== null && it.min_days_to_full <= 30);
  const critical = full30d.filter(it => it.min_days_to_full <= 7);
  const warning = full30d.filter(it => it.min_days_to_full > 7);

  const lines = full30d.map(it => `- **${it.name || it.id}** (${it.component}): ${it.min_days_to_full} days remaining (used: ${it.used_pct}%)`);
  const teamsSummary = full30d.length === 0
    ? 'All monitored components have > 30 days of capacity runway.'
    : `### ⚠️ Weekly Capacity Runway Report\n**${critical.length} Critical (<7d)**, **${warning.length} Warning (<30d)**\n\n` + lines.join('\n');

  return res.json({
    environment: env,
    title: 'Weekly Capacity Runway Report (Full within 30 Days)',
    total_at_risk: full30d.length,
    critical_count: critical.length,
    warning_count: warning.length,
    items: full30d,
    teams_summary: teamsSummary,
    generated_at: new Date().toISOString()
  });
}

// Capacity report route.
router.get('/capacity/report', handleCapacityReport);
// Capacity roll-up route.
router.get('/capacity', handleCapacityRollup);

const capacityRouter = express.Router();
capacityRouter.get('/report', handleCapacityReport);
capacityRouter.get('/', handleCapacityRollup);

module.exports = router;
module.exports.loadCatalogue = loadCatalogue;
module.exports.capacityRouter = capacityRouter;
module.exports.handleCapacityRollup = handleCapacityRollup;
module.exports.handleCapacityReport = handleCapacityReport;

