/**
 * Log store: appends, searches and aggregates logs (ClickHouse / PostgreSQL, with an in-memory
 * buffer).
 */
const postgres = require('./postgres');
const clickhouse = require('./clickhouse');
const { parseLog } = require('../logs_collection/parser/log_parser');

const MAX_RING_BUFFER = 50000;
let inMemoryRingBuffer = [];
let totalIngestedCounter = 0;
let autoIncrementId = 1;

/**
 * Encodes keyset cursor (ts, id) to base64 string
 */
function encodeCursor(ts, id) {
  if (!ts || id === undefined) return null;
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

// Sample logs for the demo environment only.
function generateDemoLogs() {
  const now = Date.now();
  const sampleMessages = [
    { app: 'bitbucket', level: 'INFO', msg: 'HTTP 200 GET /rest/api/1.0/projects/CORE/repos/sentinel/commits duration=42ms' },
    { app: 'bitbucket', level: 'WARN', msg: 'Git packfile concurrency threshold reached 80% on lon-bb-node-02' },
    { app: 'jenkins', level: 'INFO', msg: 'Build pipeline #1842 finished successfully on k8s-agent-pod-9b' },
    { app: 'jenkins', level: 'WARN', msg: 'Executor provisioning queue delayed by 18s waiting for cluster capacity' },
    { app: 'artifactory', level: 'INFO', msg: 'Artifact docker-local/sentinel:v1.4.2 SHA256 verified successfully' },
    { app: 'artifactory', level: 'ERROR', msg: 'Storage quota warning: S3 primary bucket fill rate reached 78%' },
    { app: 'database', level: 'INFO', msg: 'Vacuum analyze completed on table metric (duration=120ms)' },
    { app: 'avi_load_balancer', level: 'INFO', msg: 'VirtualService vip-bitbucket healthy: 4/4 pool members up' },
    { app: 'sonarqube', level: 'INFO', msg: 'Quality Gate passed for project sentinel-core (coverage 88.4%)' },
    { app: 'argocd', level: 'INFO', msg: 'Application sync completed: 14 resources synchronized to k8s cluster' }
  ];
  return sampleMessages.map((sm, idx) => ({
    id: 9000 + idx,
    ts: new Date(now - (idx + 1) * 60000).toISOString(),
    app_id: sm.app,
    entity_id: `app:${sm.app}`,
    environment: 'demo',
    level: sm.level,
    logger: `${sm.app}.service`,
    message: `[DEMO] ${sm.msg}`,
    fields: { host: `${sm.app}-demo-01.internal`, env: 'demo' },
    fingerprint: `fp-${sm.app}-${sm.level.toLowerCase()}`
  }));
}

/**
 * Decodes base64 keyset cursor to { ts, id }
 */
function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.ts && parsed.id !== undefined) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

/**
 * Appends an array of log items to storage (PostgreSQL write-through + in-memory ring buffer).
 * 
 * @param {Array<object>} logs - Array of raw or parsed log objects
 * @param {object} defaultMeta - Default metadata { environment, app_id, entity_id }
 * @returns {Promise<number>} Count of ingested logs
 */
async function appendLogs(logs, defaultMeta = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return 0;

  const normalized = [];
  for (const item of logs) {
    if (!item) continue;
    // If already normalized
    if (item.fingerprint && item.message && item.ts) {
      if (!item.id) item.id = autoIncrementId++;
      normalized.push(item);
    } else {
      const p = parseLog(item, defaultMeta);
      if (p) {
        p.id = autoIncrementId++;
        normalized.push(p);
      }
    }
  }

  if (normalized.length === 0) return 0;

  // 1. Maintain in-memory ring buffer
  for (const log of normalized) {
    inMemoryRingBuffer.push(log);
    totalIngestedCounter++;
  }
  if (inMemoryRingBuffer.length > MAX_RING_BUFFER) {
    inMemoryRingBuffer = inMemoryRingBuffer.slice(inMemoryRingBuffer.length - MAX_RING_BUFFER);
  }

  // 2. Persist to ClickHouse if configured
  if (clickhouse.isConfigured()) {
    try {
      await clickhouse.insertLogs(normalized.map(l => ({
        timestamp: l.ts,
        env: l.environment || 'staging',
        app_id: l.app_id || 'system',
        entity_id: l.entity_id || null,
        level: l.level || 'INFO',
        message: l.message || '',
        traceId: (l.fields && (l.fields.trace_id || l.fields.traceId)) || null,
        fields: l.fields || {}
      })));
    } catch (chErr) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[LOG_STORE] ClickHouse append failed (${chErr.message}).`);
      }
    }
  }

  // 3. Persist to PostgreSQL if available
  try {
    const pool = await postgres.getPool();
    if (pool) {
      const valueTuples = [];
      const queryParams = [];
      let pIdx = 1;

      for (const l of normalized) {
        valueTuples.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8})`);
        queryParams.push(
          new Date(l.ts),
          l.entity_id || null,
          l.app_id || 'system',
          l.environment || 'staging',
          l.level || 'INFO',
          l.logger || 'default',
          l.message || '',
          l.fields ? JSON.stringify(l.fields) : '{}',
          l.fingerprint || null
        );
        pIdx += 9;
      }

      const insertSql = `
        INSERT INTO log_event (ts, entity_id, app_id, environment, level, logger, message, fields, fingerprint)
        VALUES ${valueTuples.join(', ')}
      `;
      await pool.query(insertSql, queryParams);
    }
  } catch (err) {
    // Log warning and rely on in-memory ring-buffer
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[LOG_STORE] PostgreSQL append failed (${err.message}). Cached in ring buffer.`);
    }
  }

  return normalized.length;
}

/**
 * Searches logs using time-bounded parameters and keyset pagination.
 */
async function searchLogs(filters = {}) {
  const {
    from,
    to,
    q,
    entity_id,
    app_id,
    environment,
    level,
    fingerprint,
    limit = 50,
    cursor
  } = filters;

  if (!from || !to) {
    throw new Error('Time-bounded parameters "from" and "to" are required for log search.');
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid "from" or "to" timestamp.');
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const decodedCursor = decodeCursor(cursor);

  // Attempt query via ClickHouse if configured
  if (clickhouse.isConfigured()) {
    try {
      const fromMs = fromDate.getTime();
      const toMs = toDate.getTime();
      const params = {
        fromMs,
        toMs,
        limit: parsedLimit + 1
      };
      const where = [
        "ts >= fromUnixTimestamp64Milli({fromMs:Int64}, 'UTC')",
        "ts <= fromUnixTimestamp64Milli({toMs:Int64}, 'UTC')"
      ];
      if (environment) {
        where.push("env = {env:String}");
        params.env = environment.toLowerCase();
      }
      if (app_id) {
        where.push("app_id = {app_id:String}");
        params.app_id = app_id;
      }
      if (entity_id) {
        where.push("entity_id = {entity_id:String}");
        params.entity_id = entity_id;
      }
      if (level) {
        where.push("level = {level:String}");
        params.level = level.toUpperCase();
      }
      if (q && q.trim()) {
        where.push("lower(message) LIKE {qLike:String}");
        params.qLike = `%${q.trim().toLowerCase()}%`;
      }
      if (decodedCursor && decodedCursor.ts) {
        const cursorMs = new Date(decodedCursor.ts).getTime();
        if (!isNaN(cursorMs)) {
          params.cursorMs = cursorMs;
          where.push("ts < fromUnixTimestamp64Milli({cursorMs:Int64}, 'UTC')");
        }
      }

      const sql = `SELECT ts, env, app_id, entity_id, level, message, trace_id, fields
FROM logs
WHERE ${where.join(' AND ')}
ORDER BY ts DESC
LIMIT {limit:UInt32}`;

      const rows = await clickhouse.query(sql, params);
      const hasMore = rows.length > parsedLimit;
      const items = hasMore ? rows.slice(0, parsedLimit) : rows;

      let nextCursor = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1];
        const lastTs = last.ts;
        nextCursor = encodeCursor(typeof lastTs === 'string' ? lastTs : new Date(lastTs).toISOString(), last.trace_id || 0);
      }

      return {
        items: items.map((r, idx) => ({
          id: r.trace_id || idx + 1,
          ts: typeof r.ts === 'string' ? (r.ts.includes('T') ? r.ts : r.ts.replace(' ', 'T') + 'Z') : new Date(r.ts).toISOString(),
          entity_id: r.entity_id,
          app_id: r.app_id,
          environment: r.env,
          level: r.level,
          logger: (r.fields && r.fields.logger) || `${r.app_id}.service`,
          message: r.message,
          fields: r.fields || {},
          fingerprint: (r.fields && r.fields.fingerprint) || null
        })),
        nextCursor,
        limit: parsedLimit,
        source: 'clickhouse'
      };
    } catch (chErr) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[LOG_STORE] ClickHouse search failed (${chErr.message}). Falling back to Postgres/ring buffer.`);
      }
    }
  }

  // Attempt query via PostgreSQL
  try {
    const pool = await postgres.getPool();
    if (pool) {
      const conditions = [
        'ts >= $1',
        'ts <= $2'
      ];
      const params = [fromDate, toDate];
      let pIdx = 3;

      if (environment) {
        conditions.push(`environment = $${pIdx}`);
        params.push(environment.toLowerCase());
        pIdx++;
      }
      if (app_id) {
        conditions.push(`app_id = $${pIdx}`);
        params.push(app_id);
        pIdx++;
      }
      if (entity_id) {
        conditions.push(`entity_id = $${pIdx}`);
        params.push(entity_id);
        pIdx++;
      }
      if (level) {
        conditions.push(`level = $${pIdx}`);
        params.push(level.toUpperCase());
        pIdx++;
      }
      if (fingerprint) {
        conditions.push(`fingerprint = $${pIdx}`);
        params.push(fingerprint);
        pIdx++;
      }
      if (q && q.trim()) {
        const queryTerm = q.trim();
        conditions.push(`to_tsvector('simple', message) @@ plainto_tsquery('simple', $${pIdx})`);
        params.push(queryTerm);
        pIdx++;
      }

      // Keyset cursor condition
      if (decodedCursor) {
        conditions.push(`(ts < $${pIdx} OR (ts = $${pIdx} AND id < $${pIdx+1}))`);
        params.push(new Date(decodedCursor.ts), decodedCursor.id);
        pIdx += 2;
      }

      params.push(parsedLimit + 1);
      const querySql = `
        SELECT id, ts, entity_id, app_id, environment, level, logger, message, fields, fingerprint
        FROM log_event
        WHERE ${conditions.join(' AND ')}
        ORDER BY ts DESC, id DESC
        LIMIT $${pIdx}
      `;

      const result = await pool.query(querySql, params);
      const rows = result.rows || [];
      const hasMore = rows.length > parsedLimit;
      const items = hasMore ? rows.slice(0, parsedLimit) : rows;

      let nextCursor = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1];
        nextCursor = encodeCursor(last.ts.toISOString ? last.ts.toISOString() : last.ts, last.id);
      }

      return {
        items: items.map(r => ({
          ...r,
          ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts
        })),
        nextCursor,
        limit: parsedLimit
      };
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[LOG_STORE] PostgreSQL search failed (${err.message}). Falling back to ring buffer.`);
    }
  }

  // Fallback to in-memory ring buffer search
  const fromMs = fromDate.getTime();
  const toMs = toDate.getTime();
  const qTerms = q ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];

  let matched = inMemoryRingBuffer.filter(log => {
    const logTime = new Date(log.ts).getTime();
    if (logTime < fromMs || logTime > toMs) return false;
    if (environment && (log.environment || '').toLowerCase() !== environment.toLowerCase()) return false;
    if (app_id && log.app_id !== app_id) return false;
    if (entity_id && log.entity_id !== entity_id) return false;
    if (level && (log.level || '').toUpperCase() !== level.toUpperCase()) return false;
    if (fingerprint && log.fingerprint !== fingerprint) return false;

    if (qTerms.length > 0) {
      const haystack = `${log.message} ${log.logger} ${log.app_id} ${JSON.stringify(log.fields || {})}`.toLowerCase();
    }
    return true;
  });

  if (environment && environment.toLowerCase() === 'demo' && matched.length === 0) {
    const demoLogs = generateDemoLogs();
    matched = demoLogs.filter(log => {
      if (app_id && log.app_id !== app_id) return false;
      if (entity_id && log.entity_id !== entity_id) return false;
      if (level && (log.level || '').toUpperCase() !== level.toUpperCase()) return false;
      if (fingerprint && log.fingerprint !== fingerprint) return false;
      if (qTerms.length > 0) {
        const haystack = `${log.message} ${log.logger} ${log.app_id}`.toLowerCase();
        for (const term of qTerms) {
          if (!haystack.includes(term)) return false;
        }
      }
      return true;
    });
  }

  // Sort descending by ts and id
  matched.sort((a, b) => {
    const diff = new Date(b.ts).getTime() - new Date(a.ts).getTime();
    if (diff !== 0) return diff;
    return (b.id || 0) - (a.id || 0);
  });

  // Apply keyset cursor
  if (decodedCursor) {
    const cursorTime = new Date(decodedCursor.ts).getTime();
    const cursorId = Number(decodedCursor.id);
    matched = matched.filter(item => {
      const itemTime = new Date(item.ts).getTime();
      if (itemTime < cursorTime) return true;
      if (itemTime === cursorTime && (item.id || 0) < cursorId) return true;
      return false;
    });
  }

  const hasMore = matched.length > parsedLimit;
  const items = hasMore ? matched.slice(0, parsedLimit) : matched;
  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor(last.ts, last.id);
  }

  return {
    items,
    nextCursor,
    limit: parsedLimit
  };
}

/**
 * Computes time-bucketed histogram with severity level breakdown.
 */
async function getHistogram(filters = {}) {
  const { from, to, q, app_id, environment, level, intervalMinutes = 5 } = filters;
  if (!from || !to) {
    throw new Error('Time-bounded parameters "from" and "to" are required for log histogram.');
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const fromMs = fromDate.getTime();
  const toMs = toDate.getTime();
  const stepMs = Math.max(parseInt(intervalMinutes, 10) || 5, 1) * 60 * 1000;

  // Generate bucket slots
  const buckets = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    buckets.push({
      timestamp: new Date(t).toISOString(),
      total: 0,
      levels: { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0, DEBUG: 0 }
    });
  }

  // Get matching items from search or memory
  const searchRes = await searchLogs({ from, to, q, app_id, environment, level, limit: 500 });
  const items = searchRes.items || [];

  items.forEach(log => {
    const t = new Date(log.ts).getTime();
    const bucketIdx = Math.floor((t - fromMs) / stepMs);
    if (bucketIdx >= 0 && bucketIdx < buckets.length) {
      buckets[bucketIdx].total++;
      const lvl = (log.level || 'INFO').toUpperCase();
      if (buckets[bucketIdx].levels[lvl] !== undefined) {
        buckets[bucketIdx].levels[lvl]++;
      } else {
        buckets[bucketIdx].levels[lvl] = 1;
      }
    }
  });

  return {
    intervalMinutes: stepMs / 60000,
    buckets
  };
}

/**
 * Computes facets for top apps, levels, and frequent fingerprints.
 */
async function getFacets(filters = {}) {
  const { from, to, q, environment, app_id, level } = filters;
  if (!from || !to) {
    throw new Error('Time-bounded parameters "from" and "to" are required for log facets.');
  }

  const searchRes = await searchLogs({ from, to, q, environment, app_id, level, limit: 500 });
  const items = searchRes.items || [];

  const appCounts = {};
  const levelCounts = { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0, DEBUG: 0 };
  const fingerprintCounts = {};
  const fingerprintTemplates = {};

  items.forEach(log => {
    // App facets
    const app = log.app_id || 'system';
    appCounts[app] = (appCounts[app] || 0) + 1;

    // Level facets
    const lvl = (log.level || 'INFO').toUpperCase();
    levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;

    // Fingerprint facets
    const fp = log.fingerprint || 'fp_unknown';
    fingerprintCounts[fp] = (fingerprintCounts[fp] || 0) + 1;
    if (!fingerprintTemplates[fp]) {
      fingerprintTemplates[fp] = log.template || log.message.substring(0, 80);
    }
  });

  const apps = Object.entries(appCounts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const levels = Object.entries(levelCounts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const fingerprints = Object.entries(fingerprintCounts)
    .map(([key, count]) => ({ key, count, template: fingerprintTemplates[key] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalSampled: items.length,
    apps,
    levels,
    fingerprints
  };
}

/**
 * Returns current store health and statistics.
 */
function getStats() {
  return {
    bufferCount: inMemoryRingBuffer.length,
    bufferCapacity: MAX_RING_BUFFER,
    totalIngested: totalIngestedCounter
  };
}

/**
 * Clears in-memory buffer (primarily for testing isolation).
 */
function clearMemoryBuffer() {
  inMemoryRingBuffer = [];
  totalIngestedCounter = 0;
  autoIncrementId = 1;
}

module.exports = {
  appendLogs,
  searchLogs,
  getHistogram,
  getFacets,
  getStats,
  clearMemoryBuffer,
  encodeCursor,
  decodeCursor
};
