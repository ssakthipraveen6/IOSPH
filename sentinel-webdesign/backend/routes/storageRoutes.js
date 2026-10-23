/**
 * backend/routes/storageRoutes.js
 *
 * Phase U / U5: Storage view (Observe > Storage).
 *
 * Reads the NAS share probes pushed by sentinel-probe (agent/probe) over OTLP:
 *   nas.up, nas.stat_ms, nas.list_ms, nas.read_ms, nas.write_ms
 * with point attribute `share` (the share path) and resource `host.name`
 * (stored as entity_id `host:<fqdn>` and, when no `application.id` is sent,
 * as the component). It also reads storage-layer journey steps: the synthetics
 * runner emits `journey.step.duration_ms` and `journey.success` with point
 * attributes `journey`, `step` and `layer`; steps whose layer is `storage` are
 * the storage layer of a golden journey.
 *
 * Nothing is synthesised: a field with no stored point is `null`, and with no
 * ClickHouse or no rows the answer is DATA_UNAVAILABLE.
 */

const express = require('express');
const router = express.Router();
const { requestEnvironment } = require('./_prototype');
const clickhouse = require('../../database/clickhouse');

const NAS_METRICS = Object.freeze({
  'nas.up': 'up',
  'nas.stat_ms': 'stat',
  'nas.list_ms': 'list',
  'nas.read_ms': 'read',
  'nas.write_ms': 'write'
});
const NAS_METRIC_NAMES = Object.keys(NAS_METRICS);
const LATENCY_OPS = ['stat', 'list', 'read', 'write'];

const JOURNEY_DURATION = 'journey.step.duration_ms';
const JOURNEY_SUCCESS = 'journey.success';
const JOURNEY_METRIC_NAMES = [JOURNEY_DURATION, JOURNEY_SUCCESS];
const STORAGE_LAYER = 'storage';

const DEFAULT_WINDOW_MINUTES = 60;

const NAS_SQL = `SELECT
    component,
    entity_id,
    attributes['share'] AS share,
    metric_name,
    argMax(value, ts) AS latest,
    quantile(0.95)(value) AS p95,
    count() AS samples,
    toUnixTimestamp64Milli(max(ts)) AS last_ms
FROM metrics
WHERE env = {env:String}
  AND metric_name IN {names:Array(String)}
  AND ts >= now64(3) - toIntervalMinute({window:UInt32})
GROUP BY component, entity_id, share, metric_name
LIMIT 50000`;

const JOURNEY_SQL = `SELECT
    component,
    attributes['journey'] AS journey,
    attributes['step'] AS step,
    metric_name,
    argMax(value, ts) AS latest,
    quantile(0.95)(value) AS p95,
    avg(value) AS mean,
    count() AS samples,
    toUnixTimestamp64Milli(max(ts)) AS last_ms
FROM metrics
WHERE env = {env:String}
  AND metric_name IN {names:Array(String)}
  AND attributes['layer'] = {layer:String}
  AND ts >= now64(3) - toIntervalMinute({window:UInt32})
GROUP BY component, journey, step, metric_name
LIMIT 10000`;

// Time window in minutes.
function windowMinutes(req) {
  const n = parseInt(req.query.minutes, 10);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_MINUTES;
  return Math.min(Math.max(n, 1), 1440);
}

// Number or null.
function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Rounded to 2 decimals.
function round2(v) {
  return v === null ? null : Math.round(v * 100) / 100;
}

// Path without trailing slash.
function normPath(p) {
  return String(p || '').trim().replace(/[\\/]+$/, '');
}

// Lower-case host name.
function normHost(h) {
  return String(h || '').trim().toLowerCase();
}

// Applications as a list.
function appList(apps) {
  const list = Array.isArray(apps) ? apps : Object.values(apps || {});
  // The loader can register an app under aliases: keep one entry per id.
  return [...new Map(list.filter(a => a && a.id).map(a => [a.id, a])).values()];
}

/**
 * Manifest index used to attribute shares to products and to name journey steps:
 *   shares: Map(normalised share path -> [{ productId, hosts:Set }])
 *   steps:  Map(`${productId}|${journeyId}|${stepId}` -> { journeyName, stepName })
 */
function buildManifestIndex(apps) {
  const shares = new Map();
  const steps = new Map();
  for (const app of appList(apps)) {
    const layers = app.layers || {};
    const hosts = new Set((Array.isArray(layers.hosts) ? layers.hosts : []).map(normHost));
    for (const s of Array.isArray(layers.shares) ? layers.shares : []) {
      const key = normPath(typeof s === 'string' ? s : s && s.path);
      if (!key) continue;
      if (!shares.has(key)) shares.set(key, []);
      shares.get(key).push({ productId: app.id, hosts });
    }
    for (const j of Array.isArray(app.journeys) ? app.journeys : []) {
      if (!j || !j.id) continue;
      for (const st of Array.isArray(j.steps) ? j.steps : []) {
        if (!st || !st.id) continue;
        steps.set(`${String(app.id).toLowerCase()}|${j.id}|${st.id}`, {
          journeyName: j.name || null,
          stepName: st.name || null
        });
      }
    }
  }
  return { shares, steps };
}

const EMPTY_INDEX = Object.freeze({ shares: new Map(), steps: new Map() });

/** Collapse (component, entity, share, metric) rows into one record per host + share. */
function shapeShares(rows, index = EMPTY_INDEX) {
  const byKey = new Map();
  for (const r of rows || []) {
    const field = NAS_METRICS[r.metric_name];
    if (!field) continue;
    const share = r.share ? String(r.share) : '';
    if (!share) continue;
    const entity = r.entity_id || '';
    const component = r.component ? String(r.component) : '';
    const host = entity.startsWith('host:') ? entity.slice(5) : (component || entity || 'unknown');
    const key = `${normHost(host)}|${share}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = { host, share, entity: entity || null, components: new Set(), metrics: {}, lastMs: 0 };
      byKey.set(key, rec);
    }
    if (component) rec.components.add(component);
    const lastMs = finite(r.last_ms) || 0;
    const prev = rec.metrics[field];
    // Several series of the same metric (e.g. sent under two products): keep the freshest.
    if (!prev || lastMs >= prev.lastMs) {
      rec.metrics[field] = {
        latest: finite(r.latest),
        p95: finite(r.p95),
        samples: finite(r.samples),
        lastMs
      };
    }
    if (lastMs > rec.lastMs) rec.lastMs = lastMs;
  }

  const out = [];
  for (const rec of byKey.values()) {
    const products = new Set();
    // application.id, when the agent sent one, arrives as the component.
    for (const c of rec.components) {
      if (normHost(c) !== normHost(rec.host)) products.add(c);
    }
    for (const owner of index.shares.get(normPath(rec.share)) || []) {
      if (owner.hosts.size === 0 || owner.hosts.has(normHost(rec.host))) products.add(owner.productId);
    }

    const upM = rec.metrics.up;
    const up = upM && upM.latest !== null ? upM.latest >= 1 : null;
    const latency = {};
    for (const op of LATENCY_OPS) {
      const m = rec.metrics[op];
      latency[op] = {
        latest_ms: m ? round2(m.latest) : null,
        p95_ms: m ? round2(m.p95) : null,
        samples: m ? m.samples : 0
      };
    }
    const isSmb = /^[a-zA-Z]:[\\/]|^\\\\/.test(rec.share) || /cifs|smb/i.test(rec.share);
    out.push({
      id: `${rec.host}:${rec.share}`,
      host: rec.host,
      share: rec.share,
      entity: rec.entity,
      products: [...products].sort(),
      up,
      status: up === null ? 'UNKNOWN' : (up ? 'UP' : 'DOWN'),
      is_smb: isSmb,
      share_type: isSmb ? 'SMB/CIFS' : 'NFS',
      latency,
      last_seen: rec.lastMs ? new Date(rec.lastMs).toISOString() : null
    });
  }
  out.sort((a, b) => a.share.localeCompare(b.share) || a.host.localeCompare(b.host));
  return out;
}

/** Collapse storage-layer journey step rows into one record per product + journey + step. */
function shapeJourneySteps(rows, index = EMPTY_INDEX) {
  const byKey = new Map();
  for (const r of rows || []) {
    if (r.metric_name !== JOURNEY_DURATION && r.metric_name !== JOURNEY_SUCCESS) continue;
    const product = r.component ? String(r.component) : '';
    const journey = r.journey ? String(r.journey) : '';
    const step = r.step ? String(r.step) : '';
    if (!journey || !step) continue;
    const key = `${product}|${journey}|${step}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = { product, journey, step, duration: null, success: null, lastMs: 0 };
      byKey.set(key, rec);
    }
    const lastMs = finite(r.last_ms) || 0;
    const entry = { latest: finite(r.latest), p95: finite(r.p95), mean: finite(r.mean), samples: finite(r.samples), lastMs };
    if (r.metric_name === JOURNEY_DURATION) rec.duration = entry;
    else rec.success = entry;
    if (lastMs > rec.lastMs) rec.lastMs = lastMs;
  }

  const out = [];
  for (const rec of byKey.values()) {
    const names = index.steps.get(`${rec.product.toLowerCase()}|${rec.journey}|${rec.step}`) || {};
    const s = rec.success;
    const lastOk = s && s.latest !== null ? s.latest >= 1 : null;
    out.push({
      id: `${rec.product}:${rec.journey}:${rec.step}`,
      product: rec.product || null,
      journey: rec.journey,
      journey_name: names.journeyName || null,
      step: rec.step,
      step_name: names.stepName || null,
      layer: STORAGE_LAYER,
      status: lastOk === null ? 'UNKNOWN' : (lastOk ? 'OK' : 'FAILED'),
      success_rate: s && s.mean !== null ? round2(s.mean * 100) : null,
      runs: s ? s.samples : 0,
      duration_ms: rec.duration ? round2(rec.duration.latest) : null,
      duration_p95_ms: rec.duration ? round2(rec.duration.p95) : null,
      last_seen: rec.lastMs ? new Date(rec.lastMs).toISOString() : null
    });
  }
  out.sort((a, b) => String(a.product).localeCompare(String(b.product)) || a.journey.localeCompare(b.journey) || a.step.localeCompare(b.step));
  return out;
}

// Index of shares to applications from the manifests.
function loadIndex() {
  try {
    const yamlConfig = require('../config/yaml_config');
    return buildManifestIndex(yamlConfig.loadAllApplications() || []);
  } catch (_) {
    return EMPTY_INDEX;
  }
}

// DATA_UNAVAILABLE response.
function unavailable(res, env, reason) {
  return res.json({
    status: 'DATA_UNAVAILABLE',
    prototype: false,
    environment: env,
    reason,
    shares: [],
    journey_steps: [],
    timestamp: new Date().toISOString()
  });
}

// Storage overview from ClickHouse.
router.get('/overview', async (req, res) => {
  const env = requestEnvironment(req);
  if (!clickhouse.isConfigured()) {
    return unavailable(res, env, 'ClickHouse is not configured, so no NAS probe or journey metrics are stored.');
  }
  const window = windowMinutes(req);
  try {
    const [nasRows, journeyRows] = await Promise.all([
      clickhouse.query(NAS_SQL, { env, names: NAS_METRIC_NAMES, window }),
      clickhouse.query(JOURNEY_SQL, { env, names: JOURNEY_METRIC_NAMES, layer: STORAGE_LAYER, window })
    ]);
    const index = loadIndex();
    const shares = shapeShares(nasRows, index);
    const journeySteps = shapeJourneySteps(journeyRows, index);
    if (shares.length === 0 && journeySteps.length === 0) {
      return unavailable(res, env, `No NAS share probes (nas.*) or storage-layer journey steps stored for ${env} in the last ${window} minutes.`);
    }
    return res.json({
      prototype: false,
      environment: env,
      window_minutes: window,
      summary: {
        shares: shares.length,
        up: shares.filter(s => s.status === 'UP').length,
        down: shares.filter(s => s.status === 'DOWN').length,
        unknown: shares.filter(s => s.status === 'UNKNOWN').length,
        journey_steps: journeySteps.length,
        journey_steps_failed: journeySteps.filter(s => s.status === 'FAILED').length
      },
      shares,
      journey_steps: journeySteps,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return unavailable(res, env, `Failed to query storage telemetry: ${err.message}`);
  }
});

module.exports = router;
module.exports.NAS_METRICS = NAS_METRICS;
module.exports.NAS_SQL = NAS_SQL;
module.exports.JOURNEY_SQL = JOURNEY_SQL;
module.exports.buildManifestIndex = buildManifestIndex;
module.exports.shapeShares = shapeShares;
module.exports.shapeJourneySteps = shapeJourneySteps;
