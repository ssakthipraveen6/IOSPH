/**
 * Main data store used by the app: alerts, metrics, recoveries and settings, kept in memory, saved
 * to .runtime/sentinel_db.json and, when configured, written to PostgreSQL and ClickHouse.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const postgres = require('./postgres');
const eventStore = require('./event_store');
const clickhouse = require('./clickhouse');

// [M1.12] Source arbitration lives with ingest; loaded lazily to keep this module standalone.
let sourceArbiter = null;
// True when the source arbiter accepts this metric (avoids duplicates from two sources).
function arbiterAccepts(entry) {
  if (sourceArbiter === null) {
    try { sourceArbiter = require('../metrics_collection/source_arbiter'); } catch (_) { sourceArbiter = false; }
  }
  return sourceArbiter ? sourceArbiter.accept(entry) : true;
}

let writeNasLog;
try {
  const logger = require('@sentinel/logger');
  writeNasLog = logger.writeNasLog;
} catch (e) {
  try {
    const logger = require('../logger/logger');
    writeNasLog = logger.writeNasLog;
  } catch (_) {
    writeNasLog = (lvl, cat, msg) => console.warn(`[${lvl}] [${cat}] ${msg}`);
  }
}

// SENTINEL_RUNTIME_DIR lets tests (scripts/run_tests.js) use a throwaway folder instead of the real .runtime.
const runtimeDir = process.env.SENTINEL_RUNTIME_DIR ? path.resolve(process.env.SENTINEL_RUNTIME_DIR) : path.resolve(__dirname, '../.runtime');
const DB_FILE = fs.existsSync(runtimeDir)
  ? path.join(runtimeDir, 'sentinel_db.json')
  : path.join(__dirname, 'sentinel_db.json');

// Persistence degradation tracking for PostgreSQL write reliability
const persistenceState = {
  degraded: false,
  lastError: null,
  consecutiveFailures: 0,
  lastSuccess: null,
  totalWrites: 0,
  totalFailures: 0
};

/**
 * Executes a PostgreSQL database write operation with bounded retries,
 * exponential backoff, structured error logging, and degradation status tracking.
 */
async function executeWithRetry(operation, opName, maxRetries = 3, backoffMs = 150) {
  persistenceState.totalWrites++;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      persistenceState.lastSuccess = new Date().toISOString();
      if (persistenceState.degraded) {
        persistenceState.degraded = false;
        persistenceState.consecutiveFailures = 0;
        if (writeNasLog) {
          writeNasLog('INFO', 'DATABASE_POSTGRES', `[RECOVERED] PostgreSQL write path recovered during ${opName}.`);
        }
      }
      return result;
    } catch (err) {
      if (attempt === maxRetries) {
        persistenceState.consecutiveFailures++;
        persistenceState.totalFailures++;
        persistenceState.lastError = err.message;
        persistenceState.degraded = true;
        if (writeNasLog) {
          writeNasLog('ERROR', 'DATABASE_POSTGRES', `[DEGRADED] Persistent write failed for ${opName} after ${maxRetries} attempts: ${err.message}`);
        }
      } else {
        await new Promise(res => setTimeout(res, backoffMs * attempt));
      }
    }
  }
}

// In-memory write-behind cache & fallback state
let db = {
  metrics: [],      // array of { timestamp, component, metricName, value, env }
  alerts: [],       // array of { id, timestamp, component, severity, message, status, resolvedAt, env }
  recovery: [],     // array of { id, timestamp, component, action, triggerReason, status, steps, duration, env }
  revokedTokens: [],// array of { jti, revokedAt, reason }
  settings: {
    autonomousMode: false
  }
};

// [T2.2] Bounded In-Memory Write-Ahead Queue & Flusher for High Ingestion Throughput
const QUEUE_CAPACITY = 50000;
const BATCH_FLUSH_SIZE = 5000;
const FLUSH_INTERVAL_MS = 1000;
const BACKPRESSURE_THRESHOLD = 40000; // 80% of capacity
const MAX_ACTIVE_SERIES = 200000;

const writeQueue = [];
let sentinelIngestDroppedTotal = 0;
let cardinalityDroppedTotal = 0;
const activeSeries = new Set();
const flushLatencies = [];
let isFlushing = false;
let totalRowsIngested = 0;
let totalRowsFlushed = 0;
let rowsPerSec = 0;
let recentIngestCount = 0;

// Rate tracker
setInterval(() => {
  rowsPerSec = recentIngestCount;
  recentIngestCount = 0;
}, 1000).unref();

// Writes queued metrics to PostgreSQL.
async function flushQueue() {
  if (isFlushing || writeQueue.length === 0) return;
  isFlushing = true;
  try {
    const batchSize = Math.min(writeQueue.length, BATCH_FLUSH_SIZE);
    const batch = writeQueue.splice(0, batchSize);
    if (batch.length === 0) return;

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // [M1.8] ClickHouse is the metrics store when configured; Postgres/Timescale otherwise.
    if (clickhouse.isConfigured()) {
      await executeWithRetry(() => clickhouse.insertMetrics(batch), `flushMetricBatchClickHouse(${batch.length})`);
    } else {
      await executeWithRetry(() => postgres.saveMetricBatchToPostgres(batch, writeNasLog), `flushMetricBatch(${batch.length})`);
    }
    const elapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;

    flushLatencies.push(elapsed);
    if (flushLatencies.length > 100) flushLatencies.shift();
    totalRowsFlushed += batch.length;
  } catch (err) {
    if (writeNasLog) {
      writeNasLog('ERROR', 'DATABASE_POSTGRES', `Write queue flush error: ${err.message}`);
    }
  } finally {
    isFlushing = false;
    if (writeQueue.length >= BATCH_FLUSH_SIZE) {
      setImmediate(flushQueue);
    }
  }
}

// Background flusher interval
const flushIntervalTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS);
flushIntervalTimer.unref();

let isSaving = false;
let saveScheduled = false;

// Loads the JSON state file.
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      if (data && data.trim()) {
        db = JSON.parse(data);
      } else {
        saveDBSync();
      }
      
      db.metrics = (db.metrics || []).slice(-20000);
      db.alerts = (db.alerts || []).slice(-500);
      db.recovery = (db.recovery || []).slice(-500);
      db.revokedTokens = db.revokedTokens || [];
      db.settings = db.settings || { autonomousMode: false };
      
      console.log(`[DB] Local write-behind cache loaded. Metrics count: ${db.metrics.length}, Alerts: ${db.alerts.length}`);
    } else {
      saveDBSync();
    }
  } catch (error) {
    console.error('[DB] Failed to load local cache file:', error.message);
    saveDBSync();
  }
}

// The local file keeps control state only. Metrics live in the write queue and the
// metrics store; writing 20k points on every alert change was pure overhead.
function serializeControlState() {
  return JSON.stringify({ ...db, metrics: [] }, null, 2);
}

// Saves the JSON state file now.
function saveDBSync() {
  try {
    fs.writeFileSync(DB_FILE, serializeControlState(), 'utf8');
  } catch (error) {
    console.error('[DB] Synchronous save failed:', error.message);
  }
}

// Saves the JSON state file (debounced).
function saveDB() {
  if (isSaving) {
    saveScheduled = true;
    return;
  }
  
  isSaving = true;
  fs.writeFile(DB_FILE, serializeControlState(), 'utf8', (err) => {
    isSaving = false;
    if (err) {
      console.error('[DB] Asynchronous save failed:', err);
    }
    
    if (saveScheduled) {
      saveScheduled = false;
      saveDB();
    }
  });
}

// Auto load DB cache on module require
loadDB();

// [M1.10] Shared state across the two app nodes. Postgres holds alerts, recovery
// runs and token revocations; each node merges them into memory periodically so
// an alert or approval made on one node is visible on the other.
const SHARED_SYNC_INTERVAL_MS = 15 * 1000;

// ISO date or null.
function toIso(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

// Array from an array or JSON text.
function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
  }
  return [];
}

// Alert from a PostgreSQL row.
function mergeAlertRow(r) {
  const row = {
    id: r.id,
    timestamp: toIso(r.timestamp),
    component: r.component,
    severity: r.severity,
    message: r.message,
    status: r.status,
    resolvedAt: toIso(r.resolved_at),
    env: r.env,
    count: r.count || 1,
    last_seen: toIso(r.last_seen) || toIso(r.timestamp)
  };
  const existing = db.alerts.find(a => a.id === row.id);
  if (!existing) {
    db.alerts.push(row);
    return true;
  }
  let changed = false;
  if (row.status === 'Resolved' && existing.status !== 'Resolved') {
    existing.status = 'Resolved';
    existing.resolvedAt = row.resolvedAt || new Date().toISOString();
    changed = true;
  }
  if ((row.count || 1) > (existing.count || 1)) {
    existing.count = row.count;
    existing.last_seen = row.last_seen;
    changed = true;
  }
  return changed;
}

// Approver name.
function approverName(a) {
  return typeof a === 'string' ? a : (a && (a.username || a.email));
}

// Recovery run from a PostgreSQL row.
function mergeRecoveryRow(r) {
  const row = {
    id: r.id,
    timestamp: toIso(r.timestamp),
    component: r.component,
    action: r.action,
    triggerReason: r.trigger_reason,
    status: r.status,
    steps: parseJsonArray(r.steps),
    duration: r.duration || 0,
    approvals: parseJsonArray(r.approvals),
    env: r.env,
    initiated_by: r.initiated_by || null
  };
  const existing = db.recovery.find(x => x.id === row.id);
  if (!existing) {
    db.recovery.push(row);
    return row;
  }
  // Approvals are a union by approver; the copy with more steps is the more recent one.
  const names = new Set((existing.approvals || []).map(approverName));
  row.approvals.forEach(a => {
    if (!names.has(approverName(a))) {
      existing.approvals = existing.approvals || [];
      existing.approvals.push(a);
      names.add(approverName(a));
    }
  });
  if ((row.steps || []).length > (existing.steps || []).length) {
    existing.steps = row.steps;
    existing.status = row.status;
    existing.duration = row.duration;
  }
  return existing;
}

let lastSharedSyncError = null;
let lastSharedSyncAt = null;

// Loads shared alerts and recoveries from PostgreSQL (both nodes see the same state).
async function syncSharedStateFromPostgres() {
  try {
    const alertRes = await postgres.query(
      `SELECT id, timestamp, component, severity, message, status, resolved_at, env, count, last_seen
         FROM alert
        WHERE status = 'Active' OR timestamp > now() - interval '24 hours'
        ORDER BY timestamp DESC LIMIT 500`
    );
    if (!alertRes) return false; // no database configured
    let changed = false;
    alertRes.rows.forEach(r => { if (mergeAlertRow(r)) changed = true; });

    const runRes = await postgres.query(
      `SELECT id, timestamp, component, action, trigger_reason, status, steps, duration, approvals, env, initiated_by
         FROM recovery_run
        WHERE status IN ('Awaiting-Approval', 'In-Progress') OR timestamp > now() - interval '24 hours'
        ORDER BY timestamp DESC LIMIT 500`
    );
    if (runRes) runRes.rows.forEach(r => { mergeRecoveryRow(r); });

    try {
      const tokRes = await postgres.query(
        `SELECT jti, revoked_at, reason FROM revoked_token WHERE revoked_at > now() - interval '24 hours'`
      );
      if (tokRes) {
        db.revokedTokens = db.revokedTokens || [];
        const known = new Set(db.revokedTokens.map(t => t.jti));
        tokRes.rows.forEach(t => {
          if (!known.has(t.jti)) db.revokedTokens.push({ jti: t.jti, revokedAt: toIso(t.revoked_at), reason: t.reason });
        });
      }
    } catch (_) { /* migration 011 not applied yet */ }

    db.alerts = db.alerts.slice(-500);
    db.recovery = db.recovery.slice(-500);
    lastSharedSyncAt = new Date().toISOString();
    lastSharedSyncError = null;
    if (changed && global.broadcastStateChange) global.broadcastStateChange();
    return true;
  } catch (err) {
    lastSharedSyncError = err.message;
    return false;
  }
}

// Repeats the PostgreSQL sync in the background.
const sharedSyncTimer = setInterval(() => { syncSharedStateFromPostgres(); }, SHARED_SYNC_INTERVAL_MS);
sharedSyncTimer.unref();
setImmediate(() => { syncSharedStateFromPostgres(); });

// Demo mode synthetic generators for pristine demonstration walkthroughs
function generateDemoMetrics(component, limit = 60) {
  const now = Date.now();
  const list = [];
  const count = Math.min(limit, 30);
  
  const metricConfigs = {
    database: [
      { name: 'cpu', base: 24.5, spread: 2.5 },
      { name: 'memory', base: 45.0, spread: 1.5 },
      { name: 'transactions', base: 520, spread: 40 },
      { name: 'iops', base: 850, spread: 60 }
    ],
    avi_load_balancer: [
      { name: 'connections', base: 1840, spread: 120 },
      { name: 'ingressFlow', base: 48.5, spread: 3.5 },
      { name: 'throughput', base: 145, spread: 12 }
    ],
    network_latency: [
      { name: 'latency_ms', base: 1.15, spread: 0.1 },
      { name: 'packetLoss', base: 0.0, spread: 0.0 },
      { name: 'jitter', base: 0.08, spread: 0.02 }
    ],
    sso_gateway: [
      { name: 'authLatency', base: 45.2, spread: 4.0 },
      { name: 'activeSessions', base: 4650, spread: 150 },
      { name: 'failedAuthentications', base: 0, spread: 0 }
    ],
    linux_servers: [
      { name: 'cpu', base: 18.4, spread: 2.0 },
      { name: 'memory', base: 38.5, spread: 1.2 },
      { name: 'load', base: 1.12, spread: 0.1 }
    ],
    windows_servers: [
      { name: 'cpu', base: 20.1, spread: 1.8 },
      { name: 'memory', base: 42.0, spread: 1.5 },
      { name: 'disk', base: 58.4, spread: 0.2 }
    ],
    nas_performance: [
      { name: 'iops', base: 1450, spread: 80 },
      { name: 'throughput', base: 420, spread: 25 },
      { name: 'spaceUsed', base: 52.1, spread: 0.1 }
    ],
    s3_storage: [
      { name: 'latency', base: 12.8, spread: 1.2 },
      { name: 'bandwidth', base: 95.0, spread: 8.0 }
    ],
    // Distinct per-application baseline profiles
    artifactory: [
      { name: 'heap', base: 3.8, spread: 0.4 },
      { name: 'space', base: 1420, spread: 15 },
      { name: 'latency', base: 85.0, spread: 8.0 }
    ],
    bitbucket: [
      { name: 'responseTime', base: 24.5, spread: 3.0 },
      { name: 'successRate', base: 99.95, spread: 0.04 },
      { name: 'requests', base: 320, spread: 45 }
    ],
    jenkins_k8s: [
      { name: 'executors', base: 12, spread: 2 },
      { name: 'queue', base: 3, spread: 1 },
      { name: 'responseTime', base: 110.0, spread: 12.0 }
    ],
    jenkins: [
      { name: 'executors', base: 12, spread: 2 },
      { name: 'queue', base: 3, spread: 1 },
      { name: 'responseTime', base: 110.0, spread: 12.0 }
    ],
    sonarqube: [
      { name: 'analysisQueue', base: 2, spread: 1 },
      { name: 'qualityGatesPassed', base: 98.4, spread: 0.5 },
      { name: 'responseTime', base: 115.0, spread: 10.0 }
    ],
    fortify: [
      { name: 'scanQueue', base: 4, spread: 1 },
      { name: 'cpu', base: 32.4, spread: 4.0 },
      { name: 'failures', base: 0, spread: 0 }
    ],
    nexusiq: [
      { name: 'scanQueue', base: 1, spread: 1 },
      { name: 'violations', base: 0, spread: 0 },
      { name: 'responseTime', base: 105.0, spread: 8.0 }
    ],
    argocd_k8s: [
      { name: 'latency', base: 55.0, spread: 6.0 },
      { name: 'clusterCount', base: 8, spread: 0 }
    ],
    argocd: [
      { name: 'latency', base: 55.0, spread: 6.0 },
      { name: 'clusterCount', base: 8, spread: 0 }
    ],
    argoworkflows_k8s: [
      { name: 'activeWorkflows', base: 6, spread: 2 },
      { name: 'failedWorkflows', base: 0, spread: 0 },
      { name: 'responseTime', base: 70.0, spread: 8.0 }
    ],
    argoworkflows: [
      { name: 'activeWorkflows', base: 6, spread: 2 },
      { name: 'failedWorkflows', base: 0, spread: 0 },
      { name: 'responseTime', base: 70.0, spread: 8.0 }
    ],
    teamcity: [
      { name: 'activeBuilds', base: 8, spread: 2 },
      { name: 'agents', base: 24, spread: 0 },
      { name: 'load', base: 42.5, spread: 5.0 }
    ],
    github: [
      { name: 'apiRateLimitRemaining', base: 4850, spread: 80 },
      { name: 'pendingPullRequests', base: 14, spread: 2 },
      { name: 'responseTime', base: 110.0, spread: 10.0 }
    ],
    otkr: [
      { name: 'scanQueue', base: 1, spread: 1 },
      { name: 'findings', base: 0, spread: 0 },
      { name: 'responseTime', base: 160.0, spread: 15.0 }
    ],
    performance_center: [
      { name: 'activeTests', base: 3, spread: 1 },
      { name: 'avgResponseTime', base: 130.0, spread: 14.0 },
      { name: 'throughput', base: 840, spread: 60 }
    ],
    bitbucket_external: [
      { name: 'responseTime', base: 35.0, spread: 4.0 },
      { name: 'successRate', base: 99.92, spread: 0.05 },
      { name: 'requests', base: 140, spread: 20 }
    ],
    defaultApp: [
      { name: 'responseTime', base: 45.0, spread: 5.0 },
      { name: 'successRate', base: 99.98, spread: 0.02 },
      { name: 'requests', base: 240, spread: 35 }
    ]
  };

  const selectedMetrics = metricConfigs[component] || metricConfigs.defaultApp;

  for (let i = count - 1; i >= 0; i--) {
    const timestamp = new Date(now - i * 10000).toISOString();
    selectedMetrics.forEach(m => {
      const val = parseFloat((m.base + (Math.sin(i / 3) * m.spread)).toFixed(2));
      list.push({
        timestamp,
        component,
        metricName: m.name,
        value: m.name === 'successRate' ? Math.min(100, Math.max(99, val)) : Math.max(0, val),
        env: 'demo'
      });
    });
  }

  return list;
}

const dbManager = {
  getSettings() {
    return db.settings;
  },
  
  updateSettings(newSettings) {
    db.settings = { ...db.settings, ...newSettings };
    saveDB();
    return db.settings;
  },

  // --- Metrics Methods ---
  getMetrics(component, limit = 100, env = null) {
    const targetEnv = env || global.runtimeEnvironment || 'staging';

    // 1. DEMO MODE: return pristine demo metrics
    if (targetEnv === 'demo') {
      if (component) {
        return generateDemoMetrics(component, limit);
      }
      // Return a synthesized sample across all components
      const allDemo = [];
      [
        'database', 'avi_load_balancer', 'sso_gateway', 'network_latency', 'linux_servers', 'windows_servers', 'nas_performance', 's3_storage',
        'bitbucket', 'artifactory', 'jenkins_k8s', 'fortify', 'nexusiq', 'sonarqube', 'teamcity', 'argocd_k8s', 'argoworkflows_k8s', 'github', 'otkr', 'performance_center', 'bitbucket_external'
      ].forEach(c => {
        allDemo.push(...generateDemoMetrics(c, 10));
      });
      return allDemo;
    }

    // 2. PROD MODE: strictly return prod metrics (or unavailable if no live stream)
    if (targetEnv === 'prod') {
      let prodMetrics = db.metrics.filter(m => m.env === 'prod');
      if (component) {
        prodMetrics = prodMetrics.filter(m => m.component === component);
        if (prodMetrics.length === 0) {
          return [{
            timestamp: new Date().toISOString(),
            component,
            metricName: 'status',
            value: 'Data Not Available',
            env: 'prod'
          }];
        }
      }
      return prodMetrics.slice(-limit);
    }

    // 3. STAGING MODE: return staging metrics (or unavailable if no telemetry)
    let filtered = db.metrics.filter(m => m.env === 'staging');
    if (component) {
      filtered = filtered.filter(m => m.component === component);
      if (filtered.length === 0) {
        return [{
          timestamp: new Date().toISOString(),
          component,
          metricName: 'status',
          value: 'Data Not Available',
          env: 'staging'
        }];
      }
    }
    return filtered.slice(-limit);
  },

  /**
   * [M1.8] History reads for charts and APIs. Reads the metrics store (ClickHouse,
   * else Postgres/Timescale) so both app nodes see the same data; falls back to
   * the in-memory ring buffer. Demo keeps its synthesized series.
   */
  async queryMetrics({ component = null, metricName = null, env = 'staging', sinceMs = null, untilMs = null, limit = 2000, stepSeconds = 0 } = {}) {
    if (env === 'demo') return this.getMetrics(component, limit, env);
    if (clickhouse.isConfigured()) {
      try {
        const rows = await clickhouse.queryMetrics({ component, metricName, env, sinceMs, untilMs, limit, stepSeconds });
        if (Array.isArray(rows)) return rows;
      } catch (err) {
        persistenceState.lastError = `ClickHouse read failed: ${err.message}`;
      }
    }
    let rows = db.metrics.filter(m => m.env === env);
    if (component) rows = rows.filter(m => m.component === component);
    if (metricName) rows = rows.filter(m => m.metricName === metricName);
    if (sinceMs) rows = rows.filter(m => new Date(m.timestamp).getTime() >= sinceMs);
    if (untilMs) rows = rows.filter(m => new Date(m.timestamp).getTime() <= untilMs);
    return rows.slice(-limit);
  },

  addMetric(component, metricName, value, env = null, entity_id = null, source = 'probe') {
    const targetEnv = env || global.runtimeEnvironment || 'staging';
    const resolvedEntityId = entity_id || `app:${component}`;

    // [M1.12] Drop lower-priority duplicates while a preferred source is fresh.
    if (!arbiterAccepts({ env: targetEnv, entity_id: resolvedEntityId, component, metricName, source })) {
      return null;
    }

    // [T2.3] Cardinality Guard: Cap distinct entity_id x metric_name series
    const seriesKey = `${resolvedEntityId}::${metricName}`;
    if (!activeSeries.has(seriesKey)) {
      if (activeSeries.size >= MAX_ACTIVE_SERIES) {
        cardinalityDroppedTotal++;
        return null;
      }
      activeSeries.add(seriesKey);
    }

    // [T2.2] Backpressure: Drop lowest-priority metrics when queue hits 80% capacity
    if (writeQueue.length >= BACKPRESSURE_THRESHOLD) {
      sentinelIngestDroppedTotal++;
      return null;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      component,
      entity_id: resolvedEntityId,
      metricName,
      value: typeof value === 'number' ? parseFloat(value.toFixed(2)) : value,
      env: targetEnv,
      source
    };
    
    // In-memory ring buffer for low latency dashboard lookups
    db.metrics.push(entry);
    if (db.metrics.length > 20000) {
      db.metrics = db.metrics.slice(-20000);
    }

    // Enqueue to write-ahead queue
    writeQueue.push(entry);
    recentIngestCount++;
    totalRowsIngested++;

    // Flush immediately if batch threshold reached
    if (writeQueue.length >= BATCH_FLUSH_SIZE) {
      setImmediate(flushQueue);
    }

    // Notice: saveDB() is deleted from the metric path entirely (T2.2)
    return entry;
  },

  addMetricBatch(metricsArray, env = null) {
    if (!Array.isArray(metricsArray) || metricsArray.length === 0) return;
    const targetEnv = env || global.runtimeEnvironment || 'staging';

    for (let i = 0; i < metricsArray.length; i++) {
      const m = metricsArray[i];
      const comp = m.component || 'system';
      const metricName = m.metricName || m.name;
      const resolvedEntityId = m.entity_id || m.entityId || `app:${comp}`;
      const pointEnv = m.env || targetEnv;
      const source = m.source || 'probe';

      // [M1.12] Source arbitration
      if (!arbiterAccepts({ env: pointEnv, entity_id: resolvedEntityId, component: comp, metricName, source })) {
        continue;
      }

      // [T2.3] Cardinality Guard
      const seriesKey = `${resolvedEntityId}::${metricName}`;
      if (!activeSeries.has(seriesKey)) {
        if (activeSeries.size >= MAX_ACTIVE_SERIES) {
          cardinalityDroppedTotal++;
          continue;
        }
        activeSeries.add(seriesKey);
      }

      // [T2.2] Backpressure
      if (writeQueue.length >= BACKPRESSURE_THRESHOLD) {
        sentinelIngestDroppedTotal++;
        continue;
      }

      const entry = {
        timestamp: m.timestamp || new Date().toISOString(),
        component: comp,
        entity_id: resolvedEntityId,
        metricName,
        value: typeof m.value === 'number' ? parseFloat(m.value.toFixed(2)) : m.value,
        env: pointEnv,
        source
      };
      if (m.attributes && typeof m.attributes === 'object') entry.attributes = m.attributes;

      db.metrics.push(entry);
      writeQueue.push(entry);
      recentIngestCount++;
      totalRowsIngested++;
    }

    if (db.metrics.length > 20000) {
      db.metrics = db.metrics.slice(-20000);
    }

    if (writeQueue.length >= BATCH_FLUSH_SIZE) {
      setImmediate(flushQueue);
    }

    // Notice: saveDB() is deleted from the metric path entirely (T2.2)
  },

  getIngestStats() {
    const sorted = [...flushLatencies].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    return {
      queueDepth: writeQueue.length,
      queueCapacity: QUEUE_CAPACITY,
      rowsPerSec,
      totalIngested: totalRowsIngested,
      totalFlushed: totalRowsFlushed,
      droppedTotal: sentinelIngestDroppedTotal,
      cardinality: {
        activeSeriesCount: activeSeries.size,
        maxSeries: MAX_ACTIVE_SERIES,
        droppedTotal: cardinalityDroppedTotal
      },
      flushLatency: {
        p50Ms: Math.round(p50 * 100) / 100,
        p95Ms: Math.round(p95 * 100) / 100
      },
      persistence: { ...persistenceState }
    };
  },

  clearMetrics(env = null) {
    const targetEnv = env || global.runtimeEnvironment;
    if (targetEnv) {
      db.metrics = db.metrics.filter(m => m.env !== targetEnv);
    } else {
      db.metrics = [];
    }
    saveDB();
  },

  // --- Alerts / Incidents Methods ---
  getAlerts(env = null) {
    const targetEnv = (env || global.runtimeEnvironment || 'staging').toLowerCase();
    if (targetEnv === 'demo') {
      return [
        {
          id: 'ALT-DEMO-001',
          timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          component: 'bitbucket',
          severity: 'Warning',
          message: '[DEMO-AI] Predictive Early Warning: Heap contention on Bitbucket Node 2',
          status: 'Active',
          resolvedAt: null,
          env: 'demo'
        }
      ];
    }
    if (targetEnv === 'prod' || targetEnv === 'production') {
      return db.alerts.filter(a => a.env === 'prod' || a.env === 'production');
    }
    return db.alerts.filter(a => a.env === 'staging');
  },

  getAlertById(id) {
    if (!id || !Array.isArray(db.alerts)) return null;
    return db.alerts.find(a => a.id === id) || null;
  },

  addAlert(component, severity, message, status = 'Active', env = null) {
    let targetStatus = status || 'Active';
    let targetEnv = env;
    if (['prod', 'staging', 'demo'].includes(status) && env === null) {
      targetEnv = status;
      targetStatus = 'Active';
    } else {
      targetEnv = env || global.runtimeEnvironment || 'staging';
    }
    // [P1-03] 5-minute Alert Deduplication Window
    const DEDUP_WINDOW_MS = 5 * 60 * 1000;
    const nowMs = Date.now();
    const existing = db.alerts.find(a =>
      a.status === 'Active' &&
      a.component === component &&
      a.severity === severity &&
      a.message === message &&
      a.env === targetEnv &&
      (nowMs - new Date(a.last_seen || a.timestamp).getTime()) < DEDUP_WINDOW_MS
    );

    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.last_seen = new Date(nowMs).toISOString();
      saveDB();
      return existing;
    }

    const alertId = 'ALT-' + crypto.randomUUID().substring(0, 8).toUpperCase();
    const alert = {
      id: alertId,
      timestamp: new Date().toISOString(),
      component,
      severity,
      message,
      status: targetStatus,
      resolvedAt: null,
      env: targetEnv,
      count: 1,
      last_seen: new Date(nowMs).toISOString()
    };
    
    db.alerts.push(alert);
    
    if (db.alerts.length > 200) {
      db.alerts = db.alerts.slice(-200);
    }
    
    saveDB();

    // Emit event to eventStore and trigger correlation engine for anomalies
    const resolvedEntityId = component.startsWith('app:') || component.startsWith('host:') || component.startsWith('storage:')
      ? component
      : `app:${component}`;
    const sevNormalized = severity.toLowerCase() === 'critical' ? 'critical' : (severity.toLowerCase().includes('warn') ? 'warning' : 'info');
    
    const event = {
      event_id: 'evt-alt-' + crypto.randomUUID(),
      ts: alert.timestamp,
      entity_id: resolvedEntityId,
      kind: 'metric_anomaly',
      severity: sevNormalized,
      title: `Alert: ${component} (${severity})`,
      summary: message,
      payload: { alert_id: alert.id, status: targetStatus, rawSeverity: severity },
      environment: targetEnv,
      source: 'alerts'
    };

    eventStore.addEvent(event).then(stored => {
      if (stored && (stored.severity === 'critical' || stored.severity === 'warning')) {
        try {
          const correlation = require('@sentinel/correlation');
          correlation.correlateSymptom(stored).catch(() => {});
        } catch (_) {}
      }
    }).catch(() => {});

    // [P1-04] Direct persistence to PostgreSQL alert table
    try {
      postgres.query(`
        INSERT INTO alert (id, timestamp, component, severity, message, status, resolved_at, env, count, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          count = EXCLUDED.count,
          last_seen = EXCLUDED.last_seen,
          status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at;
      `, [
        alert.id,
        new Date(alert.timestamp),
        alert.component,
        alert.severity,
        alert.message,
        alert.status,
        alert.resolvedAt ? new Date(alert.resolvedAt) : null,
        alert.env,
        alert.count || 1,
        new Date(alert.last_seen || alert.timestamp)
      ]).catch(() => {});
    } catch (_) {}

    return alert;
  },

  /**
   * Persists lifecycle changes made to an alert object (ack, snooze, resolve,
   * rule/problem linkage) to the local cache and the Postgres `alert` table.
   */
  persistAlert(alert) {
    if (!alert || !alert.id) return;
    saveDB();
    try {
      postgres.query(`
        UPDATE alert SET
          status = $2, resolved_at = $3, rule_id = $4, acked_by = $5, acked_at = $6,
          snoozed_until = $7, resolved_by = $8, problem_id = $9, count = $10, last_seen = $11
        WHERE id = $1;
      `, [
        alert.id,
        alert.status,
        alert.resolvedAt || alert.resolved_at ? new Date(alert.resolvedAt || alert.resolved_at) : null,
        alert.rule_id || null,
        alert.acked_by || null,
        alert.acked_at ? new Date(alert.acked_at) : null,
        alert.snoozed_until ? new Date(alert.snoozed_until) : null,
        alert.resolved_by || null,
        alert.problem_id || null,
        alert.count || 1,
        new Date(alert.last_seen || alert.timestamp)
      ]).catch(() => {});
    } catch (_) {}
  },

  resolveAlertsForComponent(component, env = null) {
    const targetEnv = env || global.runtimeEnvironment || 'staging';
    let resolvedCount = 0;
    db.alerts.forEach(alert => {
      if (alert.component === component && alert.status === 'Active' && alert.env === targetEnv) {
        alert.status = 'Resolved';
        alert.resolvedAt = new Date().toISOString();
        resolvedCount++;
      }
    });
    if (resolvedCount > 0) {
      saveDB();
      try {
        postgres.query(`
          UPDATE alert
          SET status = 'Resolved', resolved_at = now()
          WHERE component = $1 AND env = $2 AND status = 'Active';
        `, [component, targetEnv]).catch(() => {});
      } catch (_) {}
    }
    return resolvedCount;
  },

  // --- Recovery Orchestrator Logs ---
  getRecoveryLogs(env = null) {
    const targetEnv = env || global.runtimeEnvironment || 'staging';
    if (targetEnv === 'demo') {
      return [
        {
          id: 'REC-DEMO-001',
          timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
          component: 'bitbucket',
          action: 'Auto-recycled JVM worker thread pool',
          triggerReason: 'Predictive GC pause threshold reached (>1.2s)',
          status: 'Resolved',
          steps: [
            `[${new Date(Date.now() - 4 * 60 * 1000).toLocaleTimeString()}] Triggered autonomous JVM worker recycle`,
            `[${new Date(Date.now() - 3 * 60 * 1000).toLocaleTimeString()}] Canary thread drained successfully`,
            `[${new Date(Date.now() - 2 * 60 * 1000).toLocaleTimeString()}] Response time normalized to 18ms (SLA Normal)`
          ],
          duration: 4,
          env: 'demo'
        }
      ];
    }
    if (targetEnv === 'prod') {
      return db.recovery.filter(r => r.env === 'prod');
    }
    return db.recovery.filter(r => r.env === 'staging');
  },

  addRecoveryRun(component, action, triggerReason, env = null, initiatedBy = null) {
    const targetEnv = (typeof env === 'string' ? env : (env && env.env)) || global.runtimeEnvironment || 'staging';
    const initiator = initiatedBy || (typeof env === 'object' && env !== null ? env.initiatedBy : null) || null;
    const runId = 'REC-' + crypto.randomUUID().substring(0, 8).toUpperCase();
    const run = {
      id: runId,
      timestamp: new Date().toISOString(),
      component,
      action,
      triggerReason,
      status: 'In-Progress',
      steps: [`[${new Date().toLocaleTimeString()}] Triggered recovery action: ${action}`],
      duration: 0,
      approvals: [],
      env: targetEnv,
      initiated_by: initiator
    };
    db.recovery.push(run);
    saveDB();

    const resolvedEntityId = component.startsWith('app:') || component.startsWith('host:') || component.startsWith('storage:')
      ? component
      : `app:${component}`;
    eventStore.addEvent({
      event_id: 'evt-rec-' + crypto.randomUUID(),
      ts: run.timestamp,
      entity_id: resolvedEntityId,
      kind: 'incident',
      severity: 'info',
      title: `Recovery Triggered: ${component} - ${action}`,
      summary: triggerReason,
      payload: { recovery_id: run.id, action, status: run.status },
      environment: targetEnv,
      source: 'recovery'
    }).catch(() => {});

    // [P1-04] Direct persistence to PostgreSQL recovery_run table
    try {
      postgres.query(`
        INSERT INTO recovery_run (id, timestamp, component, action, trigger_reason, status, steps, duration, approvals, env, initiated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          steps = EXCLUDED.steps,
          duration = EXCLUDED.duration,
          approvals = EXCLUDED.approvals;
      `, [
        run.id,
        new Date(run.timestamp),
        run.component,
        run.action,
        run.triggerReason,
        run.status,
        JSON.stringify(run.steps || []),
        run.duration || 0,
        JSON.stringify(run.approvals || []),
        run.env,
        run.initiated_by
      ]).catch(() => {});
    } catch (_) {}

    return run;
  },

  updateRecoveryRun(id, updates) {
    const run = db.recovery.find(r => r.id === id);
    if (run) {
      if (updates.step) {
        run.steps.push(`[${new Date().toLocaleTimeString()}] ${updates.step}`);
      }
      if (updates.status) {
        run.status = updates.status;
      }
      if (updates.duration !== undefined) {
        run.duration = updates.duration;
      }
      if (updates.approvals) {
        run.approvals = updates.approvals;
      }
      saveDB();
      try {
        postgres.query(`
          UPDATE recovery_run
          SET status = $2, steps = $3, duration = $4, approvals = $5
          WHERE id = $1;
        `, [
          id,
          run.status,
          JSON.stringify(run.steps || []),
          run.duration || 0,
          JSON.stringify(run.approvals || [])
        ]).catch(() => {});
      } catch (_) {}
      return run;
    }
    return null;
  },

  /**
   * [M1.10] Loads the latest copy of a recovery run from Postgres (approvals made on
   * the other node included) before it is approved. Returns the in-memory run or null.
   */
  async refreshRecoveryRun(runId) {
    try {
      const res = await postgres.query(
        `SELECT id, timestamp, component, action, trigger_reason, status, steps, duration, approvals, env, initiated_by
           FROM recovery_run WHERE id = $1`, [runId]
      );
      if (res && res.rows && res.rows[0]) return mergeRecoveryRow(res.rows[0]);
    } catch (_) { /* database unreachable: use the in-memory copy */ }
    return db.recovery.find(r => r.id === runId) || null;
  },

  syncSharedStateFromPostgres,

  // Operational health status of database persistence
  getPersistenceStatus() {
    return {
      ...persistenceState,
      metricsStore: clickhouse.isConfigured() ? 'clickhouse' : 'postgres',
      sharedStateSync: { lastSyncAt: lastSharedSyncAt, lastError: lastSharedSyncError }
    };
  },

  // Token revocation management (T0.7)
  revokeToken(jti, reason = 'Logout / Session Termination') {
    if (!jti) return false;
    if (!db.revokedTokens) db.revokedTokens = [];
    if (!db.revokedTokens.some(t => t.jti === jti)) {
      db.revokedTokens.push({
        jti,
        revokedAt: new Date().toISOString(),
        reason
      });
      saveDB();
      // [M1.10] Shared with the other node through Postgres.
      try {
        postgres.query(
          'INSERT INTO revoked_token (jti, reason) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
          [jti, reason]
        ).catch(() => {});
      } catch (_) {}
    }
    return true;
  },

  isTokenRevoked(jti) {
    if (!jti || !db.revokedTokens) return false;
    return db.revokedTokens.some(t => t.jti === jti);
  },

  // Export synchronous flush for graceful shutdown
  saveDBSync,

  async drainQueue() {
    clearInterval(flushIntervalTimer);
    clearInterval(sharedSyncTimer);
    let attempts = 0;
    while (writeQueue.length > 0 && attempts < 20) {
      await flushQueue();
      attempts++;
    }
    saveDBSync();
  }
};

module.exports = dbManager;
