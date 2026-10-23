/**
 * backend/routes/databaseRoutes.js
 *
 * M4 Task 4.9 / A7: Enterprise Database Telemetry Views (Oracle, SQL Server, PostgreSQL)
 *
 * Reads the metrics emitted by the otelcol-contrib `postgresql`, `oracledb` and
 * `sqlserver` receivers from the ClickHouse `metrics` table and shapes them per
 * database. Nothing is synthesised: a field with no stored point is `null`.
 */

const express = require('express');
const router = express.Router();
const { requestEnvironment } = require('./_prototype');
const clickhouse = require('../../database/clickhouse');

/**
 * Receiver metric name -> view field. Within one engine and field, the first
 * metric listed that has data wins (so list the preferred metric first).
 * Multiple series of the same metric (e.g. per session_type / tablespace) are
 * summed, except `replication_lag`, which takes the maximum.
 *
 * Fields: sessions | locks | waits | replication_lag | size | deadlocks
 */
const DB_RECEIVER_METRICS = Object.freeze([
  // PostgreSQL receiver (receiver/postgresqlreceiver)
  { metric: 'postgresql.backends', engine: 'postgresql', field: 'sessions', unit: '1' },
  { metric: 'postgresql.database.locks', engine: 'postgresql', field: 'locks', unit: '{lock}' },
  { metric: 'postgresql.wal.lag', engine: 'postgresql', field: 'replication_lag', unit: 's' },
  { metric: 'postgresql.wal.delay', engine: 'postgresql', field: 'replication_lag', unit: 's' },
  { metric: 'postgresql.replication.data_delay', engine: 'postgresql', field: 'replication_lag', unit: 'By' },
  { metric: 'postgresql.db_size', engine: 'postgresql', field: 'size', unit: 'By' },
  { metric: 'postgresql.deadlocks', engine: 'postgresql', field: 'deadlocks', unit: '{deadlock}' },

  // Oracle DB receiver (receiver/oracledbreceiver)
  { metric: 'oracledb.sessions.usage', engine: 'oracle', field: 'sessions', unit: '{session}' },
  { metric: 'oracledb.enqueue_locks.usage', engine: 'oracle', field: 'locks', unit: '{locks}' },
  { metric: 'oracledb.dml_locks.usage', engine: 'oracle', field: 'locks', unit: '{locks}' },
  { metric: 'oracledb.tablespace_size.usage', engine: 'oracle', field: 'size', unit: 'By' },
  { metric: 'oracledb.enqueue_deadlocks', engine: 'oracle', field: 'deadlocks', unit: '{deadlocks}' },

  // SQL Server receiver (receiver/sqlserverreceiver)
  { metric: 'sqlserver.user.connection.count', engine: 'sqlserver', field: 'sessions', unit: '{connections}' },
  { metric: 'sqlserver.lock.wait.rate', engine: 'sqlserver', field: 'locks', unit: '{requests}/s' },
  { metric: 'sqlserver.processes.blocked', engine: 'sqlserver', field: 'locks', unit: '{processes}' },
  { metric: 'sqlserver.lock.wait_time.avg', engine: 'sqlserver', field: 'waits', unit: 'ms' },
  { metric: 'sqlserver.os.wait.duration', engine: 'sqlserver', field: 'waits', unit: 's' },
  { metric: 'sqlserver.deadlock.rate', engine: 'sqlserver', field: 'deadlocks', unit: '{deadlocks}/s' },

  // O2.5 sqlquery receiver metrics:
  // Cache hit
  { metric: 'postgresql.cache_hit_ratio', engine: 'postgresql', field: 'cache_hit_pct', unit: '%' },
  { metric: 'postgresql.cache_hit_pct', engine: 'postgresql', field: 'cache_hit_pct', unit: '%' },
  { metric: 'oracle.cache_hit_ratio', engine: 'oracle', field: 'cache_hit_pct', unit: '%' },
  { metric: 'oracledb.cache_hit_ratio', engine: 'oracle', field: 'cache_hit_pct', unit: '%' },
  { metric: 'sqlserver.cache_hit_ratio', engine: 'sqlserver', field: 'cache_hit_pct', unit: '%' },

  // Tablespace / data file space
  { metric: 'postgresql.tablespace_usage.used', engine: 'postgresql', field: 'space_used_bytes', unit: 'By' },
  { metric: 'postgresql.tablespace_usage.allocated', engine: 'postgresql', field: 'space_allocated_bytes', unit: 'By' },
  { metric: 'postgresql.tablespace_usage.max', engine: 'postgresql', field: 'space_max_bytes', unit: 'By' },
  { metric: 'postgresql.tablespace_usage', engine: 'postgresql', field: 'space_used_bytes', unit: 'By' },

  { metric: 'oracle.tablespace_usage.used', engine: 'oracle', field: 'space_used_bytes', unit: 'By' },
  { metric: 'oracle.tablespace_usage.allocated', engine: 'oracle', field: 'space_allocated_bytes', unit: 'By' },
  { metric: 'oracle.tablespace_usage.max', engine: 'oracle', field: 'space_max_bytes', unit: 'By' },
  { metric: 'oracle.tablespace_usage', engine: 'oracle', field: 'space_used_bytes', unit: 'By' },

  { metric: 'sqlserver.tablespace_usage.used', engine: 'sqlserver', field: 'space_used_bytes', unit: 'By' },
  { metric: 'sqlserver.tablespace_usage.allocated', engine: 'sqlserver', field: 'space_allocated_bytes', unit: 'By' },
  { metric: 'sqlserver.tablespace_usage.max', engine: 'sqlserver', field: 'space_max_bytes', unit: 'By' },
  { metric: 'sqlserver.tablespace_usage', engine: 'sqlserver', field: 'space_used_bytes', unit: 'By' },

  // Replication lag (seconds)
  { metric: 'postgresql.replication_lag', engine: 'postgresql', field: 'replication_lag', unit: 's' },
  { metric: 'oracle.replication_lag', engine: 'oracle', field: 'replication_lag', unit: 's' },
  { metric: 'sqlserver.replication_lag', engine: 'sqlserver', field: 'replication_lag', unit: 's' },

  // Idle in transaction holding locks
  { metric: 'postgresql.idle_in_transaction_locks', engine: 'postgresql', field: 'idle_in_transaction', unit: '{sessions}' },
  { metric: 'oracle.idle_in_transaction_locks', engine: 'oracle', field: 'idle_in_transaction', unit: '{sessions}' },
  { metric: 'sqlserver.idle_in_transaction_locks', engine: 'sqlserver', field: 'idle_in_transaction', unit: '{sessions}' },

  // Backup age (hours)
  { metric: 'postgresql.backup_age', engine: 'postgresql', field: 'backup_age_hours', unit: 'h' },
  { metric: 'oracle.backup_age', engine: 'oracle', field: 'backup_age_hours', unit: 'h' },
  { metric: 'sqlserver.backup_age', engine: 'sqlserver', field: 'backup_age_hours', unit: 'h' }
]);

const FIELDS = [
  'sessions', 'locks', 'waits', 'replication_lag', 'size', 'deadlocks',
  'cache_hit_pct', 'space_used_bytes', 'space_allocated_bytes', 'space_max_bytes',
  'idle_in_transaction', 'backup_age_hours'
];

// The OTLP normalizer stores unmapped names with '.' replaced by '_', so accept both spellings.
const BY_NAME = new Map();
DB_RECEIVER_METRICS.forEach((def, priority) => {
  const entry = { ...def, priority };
  BY_NAME.set(def.metric, entry);
  BY_NAME.set(def.metric.replace(/\./g, '_'), entry);
});
const QUERY_NAMES = [...BY_NAME.keys()];

const DEFAULT_WINDOW_MINUTES = 15;

// Resource / point attributes that name the database inside a host, when stored.
const DB_NAME_SQL = `coalesce(
    nullIf(attributes['postgresql.database.name'], ''),
    nullIf(attributes['sqlserver.database.name'], ''),
    nullIf(attributes['oracledb.instance.name'], ''),
    nullIf(attributes['db.name'], ''),
    '')`;

const OVERVIEW_SQL = `SELECT
    entity_id,
    component,
    ${DB_NAME_SQL} AS db_name,
    metric_name,
    toString(attributes) AS series,
    argMax(value, ts) AS value,
    toUnixTimestamp64Milli(max(ts)) AS last_ms
FROM metrics
WHERE env = {env:String}
  AND metric_name IN {names:Array(String)}
  AND ts >= now64(3) - toIntervalMinute({window:UInt32})
GROUP BY entity_id, component, db_name, metric_name, series
LIMIT 50000`;

// Time window in minutes from the query string.
function windowMinutes(req) {
  const n = parseInt(req.query.minutes, 10);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_MINUTES;
  return Math.min(Math.max(n, 1), 1440);
}

/** Collapse raw (entity, db, metric, series) rows into one record per database. */
function shapeDatabases(rows) {
  const dbs = new Map();
  for (const r of rows || []) {
    const def = BY_NAME.get(r.metric_name);
    const value = Number(r.value);
    if (!def || !Number.isFinite(value)) continue;
    const entity = r.entity_id || r.component || 'unknown';
    const dbName = r.db_name || '';
    const key = `${def.engine}|${entity}|${dbName}`;
    let d = dbs.get(key);
    if (!d) {
      d = { engine: def.engine, entity, component: r.component || null, dbName, lastMs: 0, metrics: new Map() };
      dbs.set(key, d);
    }
    const lastMs = Number(r.last_ms) || 0;
    if (lastMs > d.lastMs) d.lastMs = lastMs;
    const m = d.metrics.get(def.metric) || { def, values: [] };
    m.values.push(value);
    d.metrics.set(def.metric, m);
  }

  const out = [];
  for (const d of dbs.values()) {
    const picked = {};
    for (const m of d.metrics.values()) {
      const cur = picked[m.def.field];
      if (!cur || m.def.priority < cur.def.priority) picked[m.def.field] = m;
    }
    const fieldValue = (field) => {
      const m = picked[field];
      if (!m) return null;
      return field === 'replication_lag'
        ? Math.max(...m.values)
        : m.values.reduce((a, b) => a + b, 0);
    };
    const units = {};
    const sourceMetrics = {};
    for (const f of FIELDS) {
      if (picked[f]) {
        units[f] = picked[f].def.unit;
        sourceMetrics[f] = picked[f].def.metric;
      }
    }
    const host = String(d.entity).replace(/^host:/, '');
    out.push({
      id: `${d.engine}:${d.entity}${d.dbName ? `/${d.dbName}` : ''}`,
      engine: d.engine,
      host,
      entity: d.entity,
      component: d.component,
      database: d.dbName || null,
      sessions: fieldValue('sessions'),
      locks: fieldValue('locks'),
      waits: fieldValue('waits'),
      replication_lag: fieldValue('replication_lag'),
      size_bytes: fieldValue('size'),
      deadlocks: fieldValue('deadlocks'),
      cache_hit_pct: fieldValue('cache_hit_pct'),
      space_used_bytes: fieldValue('space_used_bytes'),
      space_allocated_bytes: fieldValue('space_allocated_bytes'),
      space_max_bytes: fieldValue('space_max_bytes'),
      idle_in_transaction: fieldValue('idle_in_transaction'),
      backup_age_hours: fieldValue('backup_age_hours'),
      units,
      source_metrics: sourceMetrics,
      last_seen: d.lastMs ? new Date(d.lastMs).toISOString() : null
    });
  }
  out.sort((a, b) => a.engine.localeCompare(b.engine) || a.id.localeCompare(b.id));
  return out;
}

// DATA_UNAVAILABLE response.
function unavailable(res, env, reason) {
  return res.json({
    status: 'DATA_UNAVAILABLE',
    prototype: false,
    environment: env,
    reason,
    databases: [],
    timestamp: new Date().toISOString()
  });
}

// Database overview from ClickHouse.
router.get('/overview', async (req, res) => {
  const env = requestEnvironment(req);
  if (!clickhouse.isConfigured()) {
    return unavailable(res, env, 'ClickHouse is not configured, so no database receiver metrics are stored.');
  }
  const window = windowMinutes(req);
  try {
    const rows = await clickhouse.query(OVERVIEW_SQL, { env, names: QUERY_NAMES, window });
    const databases = shapeDatabases(rows);
    if (databases.length === 0) {
      return unavailable(res, env, `No PostgreSQL, Oracle or SQL Server receiver metrics stored for ${env} in the last ${window} minutes.`);
    }
    return res.json({
      prototype: false,
      environment: env,
      window_minutes: window,
      databases,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return unavailable(res, env, `Failed to query database telemetry: ${err.message}`);
  }
});

// GET /api/v2/databases/detail/:id or /api/v2/databases/:id
router.get(['/detail/:id', '/:id'], async (req, res) => {
  const env = requestEnvironment(req);
  const targetId = req.params.id;

  if (!clickhouse.isConfigured()) {
    return res.status(200).json({
      status: 'DATA_UNAVAILABLE',
      id: targetId,
      reason: 'ClickHouse is not configured.'
    });
  }

  const window = windowMinutes(req);
  try {
    const rows = await clickhouse.query(OVERVIEW_SQL, { env, names: QUERY_NAMES, window });
    const databases = shapeDatabases(rows);
    const db = databases.find(d => d.id === targetId || d.host === targetId || d.entity === targetId);

    if (!db) {
      return res.status(200).json({
        status: 'DATA_UNAVAILABLE',
        id: targetId,
        environment: env,
        reason: `No telemetry available for database '${targetId}' in ${env}`
      });
    }

    return res.json({
      status: 'OK',
      environment: env,
      database: db
    });
  } catch (err) {
    return res.status(500).json({ error: `Failed to query database detail: ${err.message}` });
  }
});

module.exports = router;
module.exports.DB_RECEIVER_METRICS = DB_RECEIVER_METRICS;
module.exports.shapeDatabases = shapeDatabases;
