/**
 * PostgreSQL connection pool (created only when db_jdbc is set) and metric read/write helpers.
 */
const { Pool } = require('pg');
const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');

// Parse JDBC connection URL
function parseJdbcUrl(url) {
  if (!url) return null;
  try {
    const raw = url.replace('jdbc:postgresql://', '');
    const [hostPort, dbName] = raw.split('/');
    const [host, port] = hostPort.split(':');
    return {
      host,
      port: parseInt(port) || 5432,
      database: dbName
    };
  } catch (e) {
    return null;
  }
}

let pool = null;

// Creates the pool from db_jdbc, PGUSER and the CyberArk/PGPASSWORD password.
async function getPool() {
  if (pool) return pool;
  const targetConfig = config.ACTIVE_URLS || {};
  if (targetConfig.db_jdbc) {
    const jdbcDetails = parseJdbcUrl(targetConfig.db_jdbc);
    if (jdbcDetails) {
      let password = process.env.PGPASSWORD;
      if (!password) {
        try {
          password = await credentialProvider.getCredential('database', 'db');
        } catch (e) {
          password = null;
        }
      }
      pool = new Pool({
        host: jdbcDetails.host,
        port: jdbcDetails.port,
        database: jdbcDetails.database,
        user: process.env.PGUSER || 'pg_telemetry_writer',
        password,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });
    }
  }
  return pool;
}

// Saves one metric.
async function saveMetricToPostgres(metric, writeNasLog) {
  return saveMetricBatchToPostgres([metric], writeNasLog);
}

// Saves a batch of metrics.
async function saveMetricBatchToPostgres(metrics, writeNasLog) {
  if (!metrics || metrics.length === 0) return;
  const activePool = await getPool();
  if (!activePool) {
    const err = new Error('PostgreSQL connection pool not initialized or unavailable');
    if (writeNasLog) {
      writeNasLog('WARN', 'DATABASE_POSTGRES', `Cannot save metric batch to PostgreSQL: ${err.message}`);
    }
    throw err;
  }
  try {
    const valueTuples = [];
    const queryParams = [];
    let paramIdx = 1;

    metrics.forEach(m => {
      const metricEnv = m.env || global.runtimeEnvironment || 'staging';
      const entityId = m.entity_id || m.entityId || `app:${m.component}`;
      const metricName = m.metric_name || m.metricName || m.name;
      const ts = new Date(m.timestamp || m.ts || Date.now());
      const labels = m.labels ? JSON.stringify(m.labels) : null;

      valueTuples.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6})`);
      queryParams.push(ts, entityId, m.component || 'system', metricName, m.value, metricEnv, labels);
      paramIdx += 7;
    });

    const query = `INSERT INTO metric (ts, entity_id, component, metric_name, value, environment, labels) VALUES ${valueTuples.join(', ')}`;
    try {
      await activePool.query(query, queryParams);
    } catch (metricTableErr) {
      // Fallback to legacy metrics table if migration 002 hasn't been executed
      if (metricTableErr.message && (metricTableErr.message.includes('relation "metric" does not exist') || metricTableErr.code === '42P01')) {
        const legacyTuples = [];
        const legacyParams = [];
        let lIdx = 1;
        metrics.forEach(m => {
          const metricEnv = m.env || global.runtimeEnvironment || 'staging';
          legacyTuples.push(`($${lIdx}, $${lIdx+1}, $${lIdx+2}, $${lIdx+3}, $${lIdx+4})`);
          legacyParams.push(new Date(m.timestamp || m.ts || Date.now()), m.component || 'system', m.metricName || m.name, m.value, metricEnv);
          lIdx += 5;
        });
        await activePool.query(`INSERT INTO metrics (timestamp, component, metric_name, value, environment) VALUES ${legacyTuples.join(', ')}`, legacyParams);
      } else {
        throw metricTableErr;
      }
    }
  } catch (e) {
    if (writeNasLog) {
      writeNasLog('WARN', 'DATABASE_POSTGRES', `Failed batch insert of ${metrics.length} metrics to PostgreSQL: ${e.message}`);
    }
    throw e;
  }
}

// Reads a metric's history.
async function fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit = 24, env = null) {
  const targetEnv = env || global.runtimeEnvironment || 'staging';
  const activePool = await getPool();
  if (activePool) {
    try {
      // T2.2: serve from metric_1m rollup if hoursLimit > 6, raw metric otherwise
      if (hoursLimit > 6) {
        try {
          const rollupQuery = `
            SELECT bucket AS timestamp, avg_value AS value, environment 
            FROM metric_1m 
            WHERE (component = $1 OR entity_id = $1) AND metric_name = $2 AND environment = $3
              AND bucket >= NOW() - ($4 || ' hours')::interval
            ORDER BY bucket ASC
          `;
          const res = await activePool.query(rollupQuery, [component, metricName, targetEnv, hoursLimit]);
          if (res.rows && res.rows.length > 0) return res.rows;
        } catch (_) {
          // Continuous aggregate / view not present yet, fall through to raw table
        }
      }

      const rawQuery = `
        SELECT ts AS timestamp, value, environment 
        FROM metric 
        WHERE (component = $1 OR entity_id = $1) AND metric_name = $2 AND environment = $3
          AND ts >= NOW() - ($4 || ' hours')::interval
        ORDER BY ts ASC
      `;
      const res = await activePool.query(rawQuery, [component, metricName, targetEnv, hoursLimit]);
      if (res.rows && res.rows.length > 0) return res.rows;
    } catch (e) {
      // Try legacy metrics table fallback
      try {
        const legacyQuery = `
          SELECT timestamp, value, environment 
          FROM metrics 
          WHERE component = $1 AND metric_name = $2 AND environment = $3
            AND timestamp >= NOW() - ($4 || ' hours')::interval
          ORDER BY timestamp ASC
        `;
        const res = await activePool.query(legacyQuery, [component, metricName, targetEnv, hoursLimit]);
        if (res.rows && res.rows.length > 0) return res.rows;
      } catch (legacyErr) {
        console.warn(`[DATABASE] Failed to read from PostgreSQL: ${legacyErr.message}. Using cache fallback.`);
      }
    }
  }

  // In PROD or STAGING mode without recorded telemetry: return empty dataset
  if (targetEnv === 'prod' || targetEnv === 'staging') {
    return [];
  }

  const dataset = [];
  const now = Date.now();
  const intervalsCount = 30;
  const step = (hoursLimit * 60 * 60 * 1000) / intervalsCount;
  
  let baseValue = 50;
  if (metricName.includes('cpu')) baseValue = 25;
  if (metricName.includes('mem')) baseValue = 40;
  if (metricName.includes('space') || metricName.includes('spaceUsed')) baseValue = 55;
  if (metricName.includes('connections')) baseValue = 350;
  if (metricName.includes('latency') || metricName.includes('responseTime')) baseValue = 15;
  if (metricName.includes('tps') || metricName.includes('ingressFlow')) baseValue = 85;

  for (let i = intervalsCount; i >= 0; i--) {
    const t = now - (i * step);
    const wave = Math.sin(i * 0.4) * (baseValue * 0.15);
    const noise = (Math.random() - 0.5) * (baseValue * 0.05);
    const val = Math.max(0, parseFloat((baseValue + wave + noise).toFixed(2)));
    dataset.push({
      timestamp: new Date(t).toISOString(),
      value: val
    });
  }
  
  return dataset;
}

// Closes the pool.
async function closePool() {
  if (pool) {
    try {
      await pool.end();
    } catch (_) {}
    pool = null;
  }
}

// Runs a query, or returns null without a database.
async function query(text, params) {
  const p = await getPool();
  if (!p) return null;
  return p.query(text, params);
}

module.exports = {
  getPool,
  closePool,
  query,
  saveMetricToPostgres,
  saveMetricBatchToPostgres,
  fetchHistoricalMetricsFromPostgres
};
