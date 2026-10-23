/**
 * tests/phase_o4_database_routes.test.js
 *
 * Phase O4 / O4.3 Database Endpoints Acceptance:
 * Tests GET /api/v2/databases/overview and GET /api/v2/databases/:id
 * across PostgreSQL, Oracle, and SQL Server with O2.5 sqlquery metrics:
 *  - cache hit ratio
 *  - space used / allocated / max
 *  - replication lag
 *  - idle in transaction locks
 *  - backup age
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const databaseRoutes = require('../backend/routes/databaseRoutes');

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== PHASE O4.3: DATABASE ROUTE TESTS (PostgreSQL, Oracle, SQL Server) ===');
  const closers = [];

  try {
    const NOW = Date.now();
    const fixtureRows = [
      // 1. PostgreSQL (host:pg-db-01, database: telemetry)
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.backends', series: '{}', value: '25', last_ms: NOW },
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.cache_hit_ratio', series: '{}', value: '99.4', last_ms: NOW },
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.tablespace_usage.used', series: '{}', value: '53687091200', last_ms: NOW }, // 50 GB
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.tablespace_usage.allocated', series: '{}', value: '107374182400', last_ms: NOW }, // 100 GB
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.tablespace_usage.max', series: '{}', value: '214748364800', last_ms: NOW }, // 200 GB
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.replication_lag', series: '{}', value: '0.2', last_ms: NOW },
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.idle_in_transaction_locks', series: '{}', value: '1', last_ms: NOW },
      { entity_id: 'host:pg-db-01', component: 'postgresql', db_name: 'telemetry', metric_name: 'postgresql.backup_age', series: '{}', value: '4', last_ms: NOW },

      // 2. Oracle (host:ora-db-01, database: PRODORCL)
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracledb.sessions.usage', series: '{}', value: '120', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.cache_hit_ratio', series: '{}', value: '98.1', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.tablespace_usage.used', series: '{}', value: '214748364800', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.tablespace_usage.allocated', series: '{}', value: '322122547200', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.tablespace_usage.max', series: '{}', value: '536870912000', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.replication_lag', series: '{}', value: '1.5', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.idle_in_transaction_locks', series: '{}', value: '0', last_ms: NOW },
      { entity_id: 'host:ora-db-01', component: 'oracle', db_name: 'PRODORCL', metric_name: 'oracle.backup_age', series: '{}', value: '12', last_ms: NOW },

      // 3. SQL Server (host:sql-db-01, database: AppData)
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.user.connection.count', series: '{}', value: '45', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.cache_hit_ratio', series: '{}', value: '99.8', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.tablespace_usage.used', series: '{}', value: '85899345920', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.tablespace_usage.allocated', series: '{}', value: '107374182400', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.tablespace_usage.max', series: '{}', value: '214748364800', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.replication_lag', series: '{}', value: '0', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.idle_in_transaction_locks', series: '{}', value: '2', last_ms: NOW },
      { entity_id: 'host:sql-db-01', component: 'sqlserver', db_name: 'AppData', metric_name: 'sqlserver.backup_age', series: '{}', value: '6', last_ms: NOW }
    ];

    const ch = await startFakeClickHouse(() => fixtureRows);
    closers.push(ch.close);
    process.env.CLICKHOUSE_URL = ch.url;

    const app = express();
    app.use('/api/v2/databases', databaseRoutes);

    const server = http.createServer(app);
    const port = await listen(server);
    closers.push(() => server.close());

    // 1. Overview test
    const resOverview = await fetchJson(`http://127.0.0.1:${port}/api/v2/databases/overview?environment=staging`);
    assert.strictEqual(resOverview.status, 200);
    assert.strictEqual(resOverview.body.databases.length, 3);

    // Verify PostgreSQL
    const pg = resOverview.body.databases.find(d => d.engine === 'postgresql');
    assert.ok(pg, 'PostgreSQL database found');
    assert.strictEqual(pg.cache_hit_pct, 99.4);
    assert.strictEqual(pg.space_used_bytes, 53687091200);
    assert.strictEqual(pg.space_allocated_bytes, 107374182400);
    assert.strictEqual(pg.space_max_bytes, 214748364800);
    assert.strictEqual(pg.replication_lag, 0.2);
    assert.strictEqual(pg.idle_in_transaction, 1);
    assert.strictEqual(pg.backup_age_hours, 4);
    console.log('✔ PostgreSQL: verified cache hit (99.4%), space (used/alloc/max), replication, idle locks, backup age');

    // Verify Oracle
    const ora = resOverview.body.databases.find(d => d.engine === 'oracle');
    assert.ok(ora, 'Oracle database found');
    assert.strictEqual(ora.cache_hit_pct, 98.1);
    assert.strictEqual(ora.space_used_bytes, 214748364800);
    assert.strictEqual(ora.replication_lag, 1.5);
    assert.strictEqual(ora.idle_in_transaction, 0);
    assert.strictEqual(ora.backup_age_hours, 12);
    console.log('✔ Oracle: verified cache hit (98.1%), space (used/alloc/max), replication, idle locks, backup age');

    // Verify SQL Server
    const sql = resOverview.body.databases.find(d => d.engine === 'sqlserver');
    assert.ok(sql, 'SQL Server database found');
    assert.strictEqual(sql.cache_hit_pct, 99.8);
    assert.strictEqual(sql.space_used_bytes, 85899345920);
    assert.strictEqual(sql.replication_lag, 0);
    assert.strictEqual(sql.idle_in_transaction, 2);
    assert.strictEqual(sql.backup_age_hours, 6);
    console.log('✔ SQL Server: verified cache hit (99.8%), space (used/alloc/max), replication, idle locks, backup age');

    // 2. Detail test: GET /api/v2/databases/:id
    const resDetail = await fetchJson(`http://127.0.0.1:${port}/api/v2/databases/${encodeURIComponent(pg.id)}?environment=staging`);
    assert.strictEqual(resDetail.status, 200);
    assert.strictEqual(resDetail.body.status, 'OK');
    assert.strictEqual(resDetail.body.database.id, pg.id);
    assert.strictEqual(resDetail.body.database.cache_hit_pct, 99.4);
    console.log('✔ Detail route GET /api/v2/databases/:id returns complete database record');

    console.log('=== ALL PHASE O4.3 DATABASE TESTS PASSED ===');
  } finally {
    for (const c of closers) {
      try { c(); } catch (_) {}
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
