const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const postgres = require('./postgres');
const eventStore = require('./event_store');

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

const runtimeDir = path.resolve(__dirname, '../.runtime');
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

async function flushQueue() {
  if (isFlushing || writeQueue.length === 0) return;
  isFlushing = true;
  try {
    const batchSize = Math.min(writeQueue.length, BATCH_FLUSH_SIZE);
    const batch = writeQueue.splice(0, batchSize);
    if (batch.length === 0) return;

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    await executeWithRetry(() => postgres.saveMetricBatchToPostgres(batch, writeNasLog), `flushMetricBatch(${batch.length})`);
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

function saveDBSync() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('[DB] Synchronous save failed:', error.message);
  }
}

function saveDB() {
  if (isSaving) {
    saveScheduled = true;
    return;
  }
  
  isSaving = true;
  fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8', (err) => {
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

  addMetric(component, metricName, value, env = null, entity_id = null) {
    const targetEnv = env || global.runtimeEnvironment || 'staging';
    const resolvedEntityId = entity_id || `app:${component}`;

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
      env: targetEnv
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
        env: m.env || targetEnv
      };

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
    const targetEnv = env || global.runtimeEnvironment || 'staging';
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
    if (targetEnv === 'prod') {
      return db.alerts.filter(a => a.env === 'prod');
    }
    return db.alerts.filter(a => a.env === 'staging');
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
    const alertId = 'ALT-' + crypto.randomUUID().substring(0, 8).toUpperCase();
    const alert = {
      id: alertId,
      timestamp: new Date().toISOString(),
      component,
      severity,
      message,
      status: targetStatus,
      resolvedAt: null,
      env: targetEnv
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

    return alert;
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

  addRecoveryRun(component, action, triggerReason, env = null) {
    const targetEnv = env || global.runtimeEnvironment || 'staging';
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
      env: targetEnv
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
      return run;
    }
    return null;
  },

  // Operational health status of database persistence
  getPersistenceStatus() {
    return { ...persistenceState };
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
    }
    return true;
  },

  isTokenRevoked(jti) {
    if (!jti || !db.revokedTokens) return false;
    return db.revokedTokens.some(t => t.jti === jti);
  },

  // Export synchronous flush for graceful shutdown
  saveDBSync
};

module.exports = dbManager;
