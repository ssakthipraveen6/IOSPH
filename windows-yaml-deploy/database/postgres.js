const { Pool } = require('pg');
const config = require('../config/config');
const sqliteMetrics = require('./sqlite_metrics');
const credentialProvider = require('../config/cyberark/credential_provider');

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
          password = 'STG_PG_SECURE_PASSWORD_VAL';
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

async function saveMetricToPostgres(metric, writeNasLog) {
  const activePool = await getPool();
  if (activePool) {
    try {
      const query = 'INSERT INTO metrics(timestamp, component, metric_name, value) VALUES($1, $2, $3, $4)';
      await activePool.query(query, [new Date(), metric.component, metric.name || metric.metricName, metric.value]);
    } catch (e) {
      if (writeNasLog) {
        writeNasLog('WARN', 'DATABASE_POSTGRES', `Failed to write telemetry metric to PostgreSQL: ${e.message}`);
      }
    }
  }
}

async function saveMetricBatchToPostgres(metrics, writeNasLog) {
  if (!metrics || metrics.length === 0) return;
  const activePool = await getPool();
  if (activePool) {
    try {
      const valueTuples = [];
      const queryParams = [];
      let paramIdx = 1;

      metrics.forEach(m => {
        valueTuples.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3})`);
        queryParams.push(new Date(m.timestamp || Date.now()), m.component, m.metricName || m.name, m.value);
        paramIdx += 4;
      });

      const query = `INSERT INTO metrics(timestamp, component, metric_name, value) VALUES ${valueTuples.join(', ')}`;
      await activePool.query(query, queryParams);
    } catch (e) {
      if (writeNasLog) {
        writeNasLog('WARN', 'DATABASE_POSTGRES', `Failed batch insert of ${metrics.length} metrics to PostgreSQL: ${e.message}`);
      }
    }
  }
}

async function fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit = 24, env = null) {
  const targetEnv = env || global.runtimeEnvironment || 'staging';
  const activePool = await getPool();
  if (activePool) {
    try {
      const query = `
        SELECT timestamp, value 
        FROM metrics 
        WHERE component = $1 AND metric_name = $2 
          AND timestamp >= NOW() - ($3 || ' hours')::interval
        ORDER BY timestamp ASC
      `;
      const res = await activePool.query(query, [component, metricName, hoursLimit]);
      if (res.rows && res.rows.length > 0) return res.rows;
    } catch (e) {
      console.warn(`[DATABASE] Failed to read from PostgreSQL: ${e.message}. Using cache fallback.`);
    }
  }

  // Fallback to SQLite records if available
  const actualRecords = sqliteMetrics.queryHistoricalMetrics(component, metricName, hoursLimit);
  if (actualRecords && actualRecords.length > 0) {
    return actualRecords;
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

module.exports = {
  getPool,
  saveMetricToPostgres,
  saveMetricBatchToPostgres,
  fetchHistoricalMetricsFromPostgres
};
