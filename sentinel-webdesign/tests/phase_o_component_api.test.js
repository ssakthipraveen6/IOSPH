/**
 * tests/phase_o_component_api.test.js
 *
 * Phase O1 / O1.2 Component Metrics API Acceptance:
 * Tests GET /api/v2/components/:kind/:id/metrics with fake ClickHouse:
 *  - Data present: returns populated series.
 *  - No data: returns { series: null, reason: 'DATA_UNAVAILABLE' }.
 *  - Wrong environment: returns 403.
 *  - 1h rollup chosen for 7-day range (asserts SQL sent contains metrics_1h).
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const componentRoutes = require('../backend/routes/componentRoutes');

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
  console.log('=== PHASE O1.2: COMPONENT METRICS API TESTS ===');
  const closers = [];

  try {
    // 1. Data present test
    const chRows = [
      { ts: '1728800000000', metric_name: 'system.cpu.utilization', value: '45.2' },
      { ts: '1728800060000', metric_name: 'system.cpu.utilization', value: '52.8' }
    ];

    let lastSql = '';
    const ch = await startFakeClickHouse((sql) => {
      lastSql = sql;
      return chRows;
    });
    closers.push(ch.close);
    process.env.CLICKHOUSE_URL = ch.url;

    const app = express();
    app.use((req, res, next) => {
      req.sentinelEnv = 'staging';
      next();
    });
    app.use('/api/v2/components', componentRoutes);

    const srv = http.createServer(app);
    const port = await listen(srv);
    closers.push(() => new Promise(r => srv.close(r)));

    const resPresent = await fetchJson(`http://127.0.0.1:${port}/api/v2/components/host_linux/test-host-01/metrics?step=60`);
    assert.strictEqual(resPresent.status, 200, `Expected 200, got ${resPresent.status}`);
    assert.strictEqual(resPresent.body.kind, 'host_linux');
    assert.strictEqual(resPresent.body.id, 'test-host-01');

    const cpuChart = resPresent.body.charts.find(c => c.id === 'cpu_utilization') || resPresent.body.charts['cpu_utilization'];
    assert.ok(cpuChart, 'cpu_utilization chart must exist');
    assert.ok(Array.isArray(cpuChart.series), 'series must be an array when data is present');
    assert.strictEqual(cpuChart.series.length, 2);
    assert.strictEqual(cpuChart.series[0].value, 45.2);
    assert.strictEqual(cpuChart.reason, null);
    console.log('✔ Passed: data present returns populated series');

    // 2. No data test (ClickHouse returns empty array)
    const chEmpty = await startFakeClickHouse(() => []);
    closers.push(chEmpty.close);
    process.env.CLICKHOUSE_URL = chEmpty.url;

    const resEmpty = await fetchJson(`http://127.0.0.1:${port}/api/v2/components/host_linux/test-host-empty/metrics?step=60`);
    assert.strictEqual(resEmpty.status, 200);
    const cpuChartEmpty = resEmpty.body.charts.find(c => c.id === 'cpu_utilization') || resEmpty.body.charts['cpu_utilization'];
    assert.ok(cpuChartEmpty, 'cpu_utilization chart must exist');
    assert.strictEqual(cpuChartEmpty.series, null, 'series must be null when no rows returned');
    assert.strictEqual(cpuChartEmpty.reason, 'DATA_UNAVAILABLE', 'reason must be DATA_UNAVAILABLE');
    console.log('✔ Passed: no data returns null series and reason DATA_UNAVAILABLE');

    // 3. Wrong / unentitled environment test
    const appForbidden = express();
    appForbidden.use((req, res, next) => {
      req.sentinelEnv = 'forbidden';
      next();
    });
    appForbidden.use('/api/v2/components', componentRoutes);

    const srvForbidden = http.createServer(appForbidden);
    const portForbidden = await listen(srvForbidden);
    closers.push(() => new Promise(r => srvForbidden.close(r)));

    const resForbidden = await fetchJson(`http://127.0.0.1:${portForbidden}/api/v2/components/host_linux/test-host-01/metrics`);
    assert.strictEqual(resForbidden.status, 403, `Expected 403 for forbidden environment, got ${resForbidden.status}`);
    console.log('✔ Passed: wrong environment returns 403');

    // 4. 1h rollup chosen for a 7-day range (assert SQL sent)
    process.env.CLICKHOUSE_URL = ch.url;
    lastSql = '';
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 3600 * 1000 - 1000;

    const resRollup = await fetchJson(`http://127.0.0.1:${port}/api/v2/components/host_linux/test-host-01/metrics?from=${sevenDaysAgo}&to=${now}`);
    assert.strictEqual(resRollup.status, 200);
    assert.strictEqual(resRollup.body.rollup, '1h', 'Response must indicate 1h rollup');
    assert.ok(lastSql.includes('metrics_1h'), `SQL query must query metrics_1h table, but got: ${lastSql}`);
    assert.ok(lastSql.includes('avgMerge(value_avg)'), `SQL query must aggregate with avgMerge(value_avg), but got: ${lastSql}`);
    console.log('✔ Passed: 1h rollup chosen for 7-day range with metrics_1h asserted in SQL');

    console.log('\n✔ ALL PHASE O1.2 COMPONENT METRICS API TESTS PASSED');
  } finally {
    for (const close of closers.reverse()) {
      try { await close(); } catch (_) {}
    }
  }
}

main().catch(err => {
  console.error('✘ Test failure in phase_o_component_api:', err);
  process.exit(1);
});
