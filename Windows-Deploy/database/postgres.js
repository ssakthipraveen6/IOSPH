const fs = require('fs');
const path = require('path');
const sqliteMetrics = require('./sqlite_metrics');

// =========================================================================
// STAGING ENVIRONMENT CONFIGURATION: POSTGRESQL HISTORICAL METRICS DB
// To configure the real Staging (STG) PostgreSQL connection secrets, update below:
// 
// STG Hostname:       Line 14
// STG Port:           Line 15
// STG Database Name:  Line 16
// STG Database User:  Line 17
// STG DB Password:    Line 18
// =========================================================================
const STG_CONFIG = {
  host: "postgres-stg-srv.internal.corp", // UPDATE STG PG HOST HERE
  port: 5432, // UPDATE STG PG PORT HERE
  database: "sentinel_historical_db", // UPDATE STG PG DATABASE HERE
  user: "pg_telemetry_writer", // UPDATE STG PG USER HERE
  password: "STG_PG_SECURE_PASSWORD_VAL" // UPDATE STG PG PASSWORD HERE
};

// Simulated historical database query engine
// In production, this would use pg pool: const pool = new pg.Pool(STG_CONFIG);
function saveMetricToPostgres(metric, writeNasLog) {
  // Simulates INSERT INTO metrics (timestamp, component, metric_name, value) VALUES ($1, $2, $3, $4)
  // Expressed as simple debug logging in the simulator
  // In real STG environments, it runs: pool.query(query, params)
}

function fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit = 24) {
  // 1. Attempt to load actual query records from local DB
  const actualRecords = sqliteMetrics.queryHistoricalMetrics(component, metricName, hoursLimit);
  if (actualRecords && actualRecords.length > 0) {
    return actualRecords;
  }

  // 2. Mock database fallback result if local DB cache is currently empty
  const dataset = [];
  const now = Date.now();
  const intervalsCount = 30; // 30 datapoints
  const step = (hoursLimit * 60 * 60 * 1000) / intervalsCount;
  
  // Baseline generator
  let baseValue = 50;
  if (metricName.includes('cpu')) baseValue = 25;
  if (metricName.includes('mem')) baseValue = 40;
  if (metricName.includes('space') || metricName.includes('spaceUsed')) baseValue = 55;
  if (metricName.includes('connections')) baseValue = 350;
  if (metricName.includes('latency') || metricName.includes('responseTime')) baseValue = 15;
  if (metricName.includes('tps') || metricName.includes('ingressFlow')) baseValue = 85;

  for (let i = intervalsCount; i >= 0; i--) {
    const t = now - (i * step);
    // Add sinusoidal wave and slight random noise for realistic PowerBI layout visualization
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
  fetchHistoricalMetricsFromPostgres,
  STG_CONFIG
};
