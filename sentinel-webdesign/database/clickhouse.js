'use strict';
/**
 * Minimal ClickHouse HTTP-interface client (port 8123). No dependencies: uses
 * Node's global fetch + AbortController.
 *
 * Configuration (resolved at call time, never cached at module load):
 *   env CLICKHOUSE_URL        e.g. http://10.0.0.5:8123   (blank => inert)
 *   env CLICKHOUSE_DATABASE   default "sentinel"
 *   env CLICKHOUSE_USER
 *   env CLICKHOUSE_PASSWORD
 *   env CLICKHOUSE_TIMEOUT_MS default 5000
 * When CLICKHOUSE_URL is not defined at all, falls back to the `clickhouse:`
 * block of config/global.yaml: { url, database, user, password_env }.
 * An explicitly empty CLICKHOUSE_URL wins over the YAML and makes the client inert.
 *
 * Requiring this module has no side effects: no timers, no network, no file IO.
 */

const DEFAULT_DATABASE = 'sentinel';
const DEFAULT_TIMEOUT_MS = 5000;
const INSERT_CHUNK_ROWS = 50000;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const state = {
  lastError: null,
  lastErrorAt: null,
  lastInsertAt: null,
  rowsInserted: 0,
};

// ---------------------------------------------------------------- config

function readYamlBlock() {
  try {
    // Lazy: only touched when the env var is absent.
    const { loadGlobalConfig } = require('../backend/config/yaml_config');
    const cfg = loadGlobalConfig() || {};
    return cfg.clickhouse && typeof cfg.clickhouse === 'object' ? cfg.clickhouse : {};
  } catch (_) {
    return {};
  }
}

// ClickHouse settings (env vars, then config/global.yaml).
function getConfig() {
  const env = process.env;
  const yamlBlock = env.CLICKHOUSE_URL === undefined ? readYamlBlock() : {};
  const url = String(env.CLICKHOUSE_URL !== undefined ? env.CLICKHOUSE_URL : (yamlBlock.url || '')).trim().replace(/\/+$/, '');
  const database = String(env.CLICKHOUSE_DATABASE || yamlBlock.database || DEFAULT_DATABASE).trim();
  const user = String(env.CLICKHOUSE_USER || yamlBlock.user || '').trim();
  let password = env.CLICKHOUSE_PASSWORD || '';
  if (!password && yamlBlock.password_env && IDENT_RE.test(String(yamlBlock.password_env))) {
    password = env[yamlBlock.password_env] || '';
  }
  const timeoutMs = Number(env.CLICKHOUSE_TIMEOUT_MS || yamlBlock.timeout_ms) || DEFAULT_TIMEOUT_MS;
  if (!IDENT_RE.test(database)) {
    throw new Error(`[ClickHouse] invalid database name "${database}"`);
  }
  return { url, database, user, password, timeoutMs };
}

/** Configured ClickHouse database name (validated identifier). */
function getDatabase() {
  return getConfig().database;
}

// True when a ClickHouse URL is set.
function isConfigured() {
  try {
    return getConfig().url !== '';
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------- helpers

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** Date | ISO string | epoch ms -> 'YYYY-MM-DD HH:MM:SS.mmm' (UTC), or null. */
function toChDateTime(v) {
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v);
  else if (typeof v === 'string' && v.trim() !== '') d = new Date(v);
  else return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** ClickHouse DateTime/DateTime64 output (UTC) -> ISO string. */
function fromChDateTime(v) {
  if (v === null || v === undefined) return null;
  let s = String(v);
  if (/^\d+(\.\d+)?$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Numbers pass; numeric strings are parsed; everything else (e.g. 'Data Not Available') is null. */
function toFiniteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Object with string values only.
function toStringMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[String(k)] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

// Value as a string.
function str(v) { return v === null || v === undefined ? '' : String(v); }

/** Serialise a JS value into ClickHouse's text form for a `param_<name>` URL parameter. */
function serializeParam(v) {
  if (v === null || v === undefined) return '\\N';
  if (v instanceof Date) return toChDateTime(v);
  if (Array.isArray(v)) {
    return '[' + v.map(x => (typeof x === 'number' ? String(x)
      : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)).join(',') + ']';
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

// Records the last error.
function recordError(err) {
  state.lastError = err && err.message ? err.message : String(err);
  state.lastErrorAt = new Date().toISOString();
}

// ---------------------------------------------------------------- transport

/**
 * Low-level request. `query` goes in the URL when a body is supplied (inserts),
 * otherwise SQL is the POST body. Never put user input into `sql`: use params.
 */
async function request(sql, { params = {}, body = null, database, settings = {}, timeoutMs } = {}) {
  const cfg = getConfig();
  if (!cfg.url) throw new Error('[ClickHouse] not configured (CLICKHOUSE_URL is blank)');

  const qs = new URLSearchParams();
  const db = database === undefined ? cfg.database : database;
  if (db) qs.set('database', db);
  for (const [k, v] of Object.entries(settings)) qs.set(k, String(v));
  for (const [k, v] of Object.entries(params || {})) {
    if (!IDENT_RE.test(k)) throw new Error(`[ClickHouse] invalid parameter name "${k}"`);
    qs.set(`param_${k}`, serializeParam(v));
  }
  // [S7] Migration-style `{db}.table` references resolve to the configured database
  // (`{db}` has no `:Type`, so it never collides with a query parameter placeholder).
  sql = String(sql).replace(/\{db\}\./g, db ? `${db}.` : '');
  let payload = sql;
  if (body !== null) {
    qs.set('query', sql);
    payload = body;
  }

  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  if (cfg.user) headers['X-ClickHouse-User'] = cfg.user;
  if (cfg.password) headers['X-ClickHouse-Key'] = cfg.password;

  const controller = new AbortController();
  const ms = timeoutMs || cfg.timeoutMs;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let res;
    try {
      res = await fetch(`${cfg.url}/?${qs.toString()}`, { method: 'POST', headers, body: payload, signal: controller.signal });
    } catch (e) {
      const reason = e && e.name === 'AbortError' ? `timed out after ${ms}ms` : (e.cause && e.cause.message) || e.message;
      throw new Error(`[ClickHouse] request failed: ${reason}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`[ClickHouse] HTTP ${res.status}: ${text.trim().slice(0, 2000)}`);
    return text;
  } catch (err) {
    recordError(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Parses JSONEachRow output.
function parseJsonEachRow(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

// ---------------------------------------------------------------- public API

/** Resolves true when the server answers SELECT 1; never throws. */
async function ping() {
  if (!isConfigured()) return false;
  try {
    const text = await request('SELECT 1', { database: '' });
    return text.trim() === '1';
  } catch (_) {
    return false;
  }
}

/**
 * Run a read query and return row objects. Parameters use ClickHouse's
 * `{name:Type}` placeholders in `sql` and are sent as `param_name` URL params.
 */
async function query(sql, params = {}, opts = {}) {
  const text = await request(sql, {
    ...opts,
    params,
    settings: { default_format: 'JSONEachRow', output_format_json_quote_64bit_integers: 0, ...(opts.settings || {}) },
  });
  return parseJsonEachRow(text);
}

/** Run a statement (DDL etc.) that returns no rows. */
async function command(sql, params = {}, opts = {}) {
  await request(sql, { ...opts, params });
}

// Inserts rows into a table.
async function insertRows(table, rows, opts = {}) {
  if (!IDENT_RE.test(table)) throw new Error(`[ClickHouse] invalid table "${table}"`);
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    const body = chunk.map(r => JSON.stringify(r)).join('\n') + '\n';
    await request(`INSERT INTO ${table} FORMAT JSONEachRow`, {
      ...opts,
      body,
      settings: { input_format_skip_unknown_fields: 1 },
    });
  }
  state.rowsInserted += rows.length;
  state.lastInsertAt = new Date().toISOString();
  return rows.length;
}

/**
 * entries: [{ timestamp, component, entity_id, metricName, value, env, source?, attributes? }]
 * Entries with a non-numeric value, no timestamp, no metric name or no env are skipped
 * (never coerced). Resolves to the number of rows inserted.
 */
async function insertMetrics(entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const rows = [];
  for (const e of entries) {
    if (!e) continue;
    const value = toFiniteNumber(e.value);
    const ts = toChDateTime(e.timestamp);
    const metricName = e.metricName || e.name;
    if (value === null || !ts || !metricName || !e.env) continue;
    rows.push({
      ts,
      env: String(e.env),
      component: str(e.component),
      entity_id: str(e.entity_id || e.entityId),
      metric_name: String(metricName),
      value,
      source: e.source ? String(e.source) : 'collector',
      attributes: toStringMap(e.attributes),
    });
  }
  return insertRows('metrics', rows, opts);
}

/**
 * records: [{ timestamp|ts, env, app_id|appId|component, entity_id, level, message, trace_id|traceId, fields? }]
 * Records without a timestamp or env are skipped.
 */
async function insertLogs(records, opts = {}) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const rows = [];
  for (const r of records) {
    if (!r) continue;
    const ts = toChDateTime(r.timestamp !== undefined ? r.timestamp : r.ts);
    if (!ts || !r.env) continue;
    rows.push({
      ts,
      env: String(r.env),
      app_id: str(r.app_id || r.appId || r.component),
      entity_id: str(r.entity_id || r.entityId),
      level: str(r.level || r.severity).toUpperCase(),
      message: str(r.message),
      trace_id: str(r.trace_id || r.traceId),
      fields: toStringMap(r.fields || r.attributes),
    });
  }
  return insertRows('logs', rows, opts);
}

/**
 * spans: [{ trace_id, span_id, parent_span_id?, name, service, env, start_ts|startTime, duration_ms, status?, attributes? }]
 * Spans without ids, start time, env or a numeric duration are skipped.
 */
async function insertSpans(spans, opts = {}) {
  if (!Array.isArray(spans) || spans.length === 0) return 0;
  const rows = [];
  for (const s of spans) {
    if (!s) continue;
    const traceId = s.trace_id || s.traceId;
    const spanId = s.span_id || s.spanId;
    const start = toChDateTime(s.start_ts !== undefined ? s.start_ts : (s.startTime !== undefined ? s.startTime : s.timestamp));
    const duration = toFiniteNumber(s.duration_ms !== undefined ? s.duration_ms : s.durationMs);
    if (!traceId || !spanId || !start || duration === null || !s.env) continue;
    rows.push({
      trace_id: String(traceId),
      span_id: String(spanId),
      parent_span_id: str(s.parent_span_id || s.parentSpanId),
      name: str(s.name),
      service: str(s.service),
      env: String(s.env),
      start_ts: start,
      duration_ms: duration,
      status: str(s.status),
      attributes: toStringMap(s.attributes),
    });
  }
  return insertRows('spans', rows, opts);
}

/**
 * events: [{ ts|timestamp, env|environment, entity_id?, kind?, severity?, title?, summary?, payload?|details?, source? }]
 */
async function insertEvents(events, opts = {}) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const rows = [];
  for (const e of events) {
    if (!e) continue;
    const ts = toChDateTime(e.ts !== undefined ? e.ts : e.timestamp);
    const env = e.env || e.environment;
    if (!ts || !env) continue;
    const payloadStr = typeof e.payload === 'string'
      ? e.payload
      : JSON.stringify(e.payload !== undefined ? e.payload : (e.details !== undefined ? e.details : {}));
    rows.push({
      ts,
      env: String(env),
      entity_id: str(e.entity_id || e.entityId),
      kind: str(e.kind || 'system_event'),
      severity: str(e.severity || 'warning'),
      title: str(e.title || e.summary || 'System Event'),
      payload: payloadStr,
      source: str(e.source || 'pipeline')
    });
  }
  return insertRows('events', rows, opts);
}

/**
 * agent_inventory: [{ host, env, agent_version?, os?, last_seen?, config_hash? }]
 */
async function insertAgentInventory(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const rows = [];
  for (const item of items) {
    if (!item || !item.host) continue;
    const ts = toChDateTime(item.last_seen || Date.now());
    rows.push({
      host: String(item.host),
      env: String(item.env || item.environment || 'production'),
      agent_version: str(item.agent_version || item.version || '2.4.0'),
      os: str(item.os || 'linux'),
      last_seen: ts,
      config_hash: str(item.config_hash || '')
    });
  }
  return insertRows('agent_inventory', rows, opts);
}

/**
 * Read metric points back in the in-memory entry shape, oldest first.
 * stepSeconds >= 60 reads the metrics_1m rollup (avg per bucket); otherwise raw points.
 */
async function queryMetrics({ component, metricName, env, sinceMs, untilMs, limit, stepSeconds } = {}) {
  if (!env) throw new Error('[ClickHouse] queryMetrics requires env');
  const now = Date.now();
  const until = Number.isFinite(Number(untilMs)) && untilMs !== undefined && untilMs !== null ? Math.trunc(Number(untilMs)) : now;
  const since = Number.isFinite(Number(sinceMs)) && sinceMs !== undefined && sinceMs !== null ? Math.trunc(Number(sinceMs)) : until - 3600 * 1000;
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 10000, 1), 100000);
  const step = Math.trunc(Number(stepSeconds)) || 0;

  const params = { env: String(env), since, until, limit: lim };
  const where = [
    'env = {env:String}',
    "ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')",
    "ts < fromUnixTimestamp64Milli({until:Int64}, 'UTC')",
  ];
  if (component) { where.push('component = {component:String}'); params.component = String(component); }
  if (metricName) { where.push('metric_name = {metricName:String}'); params.metricName = String(metricName); }

  let sql;
  if (step >= 3600) {
    params.step = step;
    sql = `SELECT toStartOfInterval(ts, toIntervalSecond({step:UInt32})) AS bucket, env, component, entity_id, metric_name, source,
       avgMerge(value_avg) AS value
FROM metrics_1h
WHERE ${where.join(' AND ')}
GROUP BY bucket, env, component, entity_id, metric_name, source
ORDER BY bucket ASC
LIMIT {limit:UInt32}`;
  } else if (step >= 60) {
    params.step = step;
    sql = `SELECT toStartOfInterval(ts, toIntervalSecond({step:UInt32})) AS bucket, env, component, entity_id, metric_name, source,
       avgMerge(value_avg) AS value
FROM metrics_1m
WHERE ${where.join(' AND ')}
GROUP BY bucket, env, component, entity_id, metric_name, source
ORDER BY bucket ASC
LIMIT {limit:UInt32}`;
  } else {
    sql = `SELECT ts AS bucket, env, component, entity_id, metric_name, source, value
FROM metrics
WHERE ${where.join(' AND ')}
ORDER BY ts ASC
LIMIT {limit:UInt32}`;
  }

  const rows = await query(sql, params);
  return rows.map(r => ({
    timestamp: fromChDateTime(r.bucket),
    component: r.component,
    entity_id: r.entity_id,
    metricName: r.metric_name,
    value: typeof r.value === 'number' ? r.value : toFiniteNumber(r.value),
    env: r.env,
    source: r.source,
  }));
}

// Connection status and last error.
function getStatus() {
  return {
    configured: isConfigured(),
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    lastInsertAt: state.lastInsertAt,
    rowsInserted: state.rowsInserted,
  };
}

module.exports = {
  getDatabase,
  isConfigured,
  getConfig,
  ping,
  query,
  command,
  insertRows,
  insertMetrics,
  insertLogs,
  insertSpans,
  insertEvents,
  insertAgentInventory,
  queryMetrics,
  getStatus,
  // exported for tests / the migrator
  _internals: { toChDateTime, fromChDateTime, toFiniteNumber, serializeParam },
};
