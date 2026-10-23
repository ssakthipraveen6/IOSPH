/**
 * tests/phase_o3_infra_routes.test.js
 *
 * Phase O3 / O3.1 Infrastructure Hosts API Acceptance:
 * Tests GET /api/v2/infra/hosts?os=linux|windows:
 *  - Data present: returns 200 OK with shaped host records, metrics, product mappings, agent state.
 *  - OS filter: returns only matching OS.
 *  - No data: returns status 'DATA_UNAVAILABLE' and empty hosts array.
 *  - Wrong environment / forbidden access: returns 403.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createInfraRouter } = require('../backend/routes/infraRoutes');

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
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

function memoryInventory(entities = []) {
  const store = [...entities];
  return {
    async getEntities({ kind, environment }) {
      return store.filter(e =>
        (!kind || String(e.kind).toLowerCase() === String(kind).toLowerCase()) &&
        (!environment || e.environment === environment)
      );
    }
  };
}

async function main() {
  console.log('=== PHASE O3.1: INFRASTRUCTURE HOSTS API TESTS ===');
  const closers = [];

  try {
    const mockEntities = [
      {
        entity_id: 'host:app-prod-01.infra',
        name: 'app-prod-01.infra',
        kind: 'host',
        environment: 'staging',
        status: 'HEALTHY',
        labels: {
          os: 'linux',
          cpu_utilization: 42.5,
          memory_utilization: 68.1,
          disk_utilization: 55.0,
          network_bytes_sec: 1048576,
          worst_filesystem_pct: 78.4,
          agent_version: '3.4.0',
          last_heartbeat: new Date().toISOString()
        }
      },
      {
        entity_id: 'host:win-db-01.corp',
        name: 'win-db-01.corp',
        kind: 'host',
        environment: 'staging',
        status: 'HEALTHY',
        labels: {
          os: 'windows',
          cpu_utilization: 25.0,
          memory_utilization: 82.3,
          disk_utilization: 40.0,
          worst_filesystem_pct: 61.2,
          agent_version: '3.4.0',
          last_heartbeat: new Date().toISOString()
        }
      }
    ];

    const inv = memoryInventory(mockEntities);

    // 1. Data present test (staging)
    const app = express();
    app.use((req, res, next) => {
      req.sentinelEnv = 'staging';
      req.user = { role: 'admin', permissions: ['READ', 'WRITE'] };
      next();
    });
    app.use('/api/v2/infra', createInfraRouter({ inv }));

    const server = http.createServer(app);
    const port = await listen(server);
    closers.push(() => server.close());

    const resAll = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/hosts`);
    assert.strictEqual(resAll.status, 200);
    assert.strictEqual(resAll.body.status, 'OK');
    assert.strictEqual(resAll.body.count, 2);
    assert.strictEqual(resAll.body.hosts.length, 2);

    const linuxHost = resAll.body.hosts.find(h => h.host === 'app-prod-01.infra');
    assert.ok(linuxHost, 'Linux host found');
    assert.strictEqual(linuxHost.os, 'linux');
    assert.strictEqual(linuxHost.cpu_latest, 42.5);
    assert.strictEqual(linuxHost.memory_latest, 68.1);
    assert.strictEqual(linuxHost.worst_filesystem_pct, 78.4);
    assert.ok(linuxHost.agent_state, 'agent_state present');
    assert.strictEqual(linuxHost.agent_state.has_agent, true);
    assert.strictEqual(linuxHost.agent_state.agent_version, '3.4.0');
    console.log('✔ Data present: retrieved shaped Linux and Windows hosts with metrics and agent state');

    // 2. OS filter: ?os=linux
    const resLinux = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/hosts?os=linux`);
    assert.strictEqual(resLinux.status, 200);
    assert.strictEqual(resLinux.body.count, 1);
    assert.strictEqual(resLinux.body.hosts[0].host, 'app-prod-01.infra');
    assert.strictEqual(resLinux.body.hosts[0].os, 'linux');
    console.log('✔ OS filter ?os=linux returns only Linux hosts');

    // 3. OS filter: ?os=windows
    const resWin = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/hosts?os=windows`);
    assert.strictEqual(resWin.status, 200);
    assert.strictEqual(resWin.body.count, 1);
    assert.strictEqual(resWin.body.hosts[0].host, 'win-db-01.corp');
    assert.strictEqual(resWin.body.hosts[0].os, 'windows');
    console.log('✔ OS filter ?os=windows returns only Windows hosts');

    // 4. Empty data test: environment with no hosts returns DATA_UNAVAILABLE
    const appEmpty = express();
    appEmpty.use((req, res, next) => {
      req.sentinelEnv = 'prod';
      req.user = { role: 'admin', permissions: ['READ', 'WRITE'] };
      next();
    });
    appEmpty.use('/api/v2/infra', createInfraRouter({ inv }));
    const serverEmpty = http.createServer(appEmpty);
    const portEmpty = await listen(serverEmpty);
    closers.push(() => serverEmpty.close());

    const resEmpty = await fetchJson(`http://127.0.0.1:${portEmpty}/api/v2/infra/hosts`);
    assert.strictEqual(resEmpty.status, 200);
    assert.strictEqual(resEmpty.body.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(resEmpty.body.environment, 'prod');
    assert.deepStrictEqual(resEmpty.body.hosts, []);
    assert.ok(typeof resEmpty.body.reason === 'string');
    console.log('✔ Empty data: returns DATA_UNAVAILABLE with reason and empty array');

    // 5. Wrong environment / Access denied test (e.g. viewer blocked from prod)
    const appDeny = express();
    appDeny.use((req, res, next) => {
      req.sentinelEnv = 'forbidden';
      next();
    });
    appDeny.use('/api/v2/infra', createInfraRouter({ inv }));
    const serverDeny = http.createServer(appDeny);
    const portDeny = await listen(serverDeny);
    closers.push(() => serverDeny.close());

    const resDeny = await fetchJson(`http://127.0.0.1:${portDeny}/api/v2/infra/hosts`);
    assert.strictEqual(resDeny.status, 403);
    assert.strictEqual(resDeny.body.error, 'Access denied for requested environment');
    console.log('✔ Forbidden access: returns 403 for unauthorized environment');

    console.log('=== ALL PHASE O3.1 INFRASTRUCTURE TESTS PASSED ===');
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
