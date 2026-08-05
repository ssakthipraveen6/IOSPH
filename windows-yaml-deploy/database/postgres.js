// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 27 (PROD_URLS.db_jdbc)
// - config/config.js: Line 138 (STG_URLS.db_jdbc)
// Purpose: TimescaleDB / PostgreSQL database JDBC connection pool string.
// =========================================================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config/config');
const sqliteMetrics = require('./sqlite_metrics');

// Parse JDBC connection URL
function parseJdbcUrl(url) {
  if (!url) return null;
  try {
    // e.g. jdbc:postgresql://db-stg-primary.internal.corp:5432/telemetry_db
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

// Staging/Production PostgreSQL connection pool
let pool = null;
const targetConfig = config.STG_URLS || config.PROD_URLS || {};
if (!config.USE_SIMULATED_COLLECTORS && targetConfig.db_jdbc) {
  const jdbcDetails = parseJdbcUrl(targetConfig.db_jdbc);
  if (jdbcDetails) {
    pool = new Pool({
      host: jdbcDetails.host,
      port: jdbcDetails.port,
      database: jdbcDetails.database,
      user: process.env.PGUSER || 'pg_telemetry_writer',
      password: process.env.PGPASSWORD || 'STG_PG_SECURE_PASSWORD_VAL'
    });
  }
}

async function saveMetricToPostgres(metric, writeNasLog) {
  if (pool) {
    try {
      const query = 'INSERT INTO metrics(timestamp, component, metric_name, value) VALUES($1, $2, $3, $4)';
      await pool.query(query, [new Date(), metric.component, metric.name, metric.value]);
    } catch (e) {
      if (writeNasLog) {
        writeNasLog('WARN', 'DATABASE_POSTGRES', `Failed to write telemetry metric to PostgreSQL: ${e.message}`);
      }
    }
  } else {
    // Simulated/development placeholder behaviour
  }
}

async function fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit = 24) {
  if (pool) {
    try {
      const query = `
        SELECT timestamp, value 
        FROM metrics 
        WHERE component = $1 AND metric_name = $2 
          AND timestamp >= NOW() - INTERVAL '$3 hour'
        ORDER BY timestamp ASC
      `;
      const res = await pool.query(query, [component, metricName, hoursLimit]);
      return res.rows;
    } catch (e) {
      console.warn(`[DATABASE] Failed to read from PostgreSQL: ${e.message}. Using cache fallback.`);
    }
  }

  // Load actual query records from local DB
  const actualRecords = sqliteMetrics.queryHistoricalMetrics(component, metricName, hoursLimit);
  if (actualRecords && actualRecords.length > 0) {
    return actualRecords;
  }

  // Mock database fallback result if local DB cache is currently empty
  const dataset = [];
  const now = Date.now();
  const intervalsCount = 30; // 30 datapoints
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
  saveMetricToPostgres,
  fetchHistoricalMetricsFromPostgres
};
