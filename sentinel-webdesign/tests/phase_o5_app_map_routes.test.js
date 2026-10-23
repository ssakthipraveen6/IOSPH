/**
 * tests/phase_o5_app_map_routes.test.js
 *
 * Phase O5 / O5.1 Acceptance Tests:
 * Tests GET /api/v2/apps/:id/map?from&to:
 *  - Ordered layers: Users → DNS → AVI VIP → SSO → app servers → storage → DB → dependencies
 *  - Each node: kind, id, status, headline metric, sparkline series, reason when null, open alerts, open problem marker
 *  - When a problem is open: top_layer node marked 'failing' and later nodes 'affected_downstream'
 *  - Layer without data returns null metrics + reason 'DATA_UNAVAILABLE'
 *  - Environment isolation & 403 on unentitled access
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createAppMapRouter } = require('../backend/routes/appMapRoutes');

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

async function main() {
  console.log('=== PHASE O5.1: APPLICATION MAP API TESTS ===');
  const closers = [];

  try {
    const mockAppManifest = {
      id: 'bitbucket',
      name: 'Bitbucket Enterprise',
      layers: {
        vip: 'https://bitbucket-prod.internal.corp',
        hosts: ['bb-app-01.internal.corp', 'bb-app-02.internal.corp'],
        shares: ['/mnt/nfs/bitbucket_shared'],
        databases: ['jdbc:postgresql://db-bb:5432/bitbucket'],
        docker: { registry_api: 'https://registry-prod.internal.corp/v2/bitbucket' }
      }
    };

    const mockYamlConfig = {
      loadAllApplications: () => ({ bitbucket: mockAppManifest })
    };

    // Scenario 1: Telemetry present, No problem open -> layers ordered, healthy status, metrics present
    {
      const fakeCh = {
        isConfigured: () => true,
        query: async (sql, params) => {
          return [
            {
              entity_id: 'app:bitbucket',
              metric_name: 'journey.duration_ms',
              avg_val: '142.5',
              points: [[1700000000000, 140], [1700000060000, 145]]
            },
            {
              entity_id: 'vip:bitbucket',
              metric_name: 'vip.total_ms',
              avg_val: '78.2',
              points: [[1700000000000, 75], [1700000060000, 81]]
            },
            {
              entity_id: 'host:bb-app-01.internal.corp',
              metric_name: 'system.cpu.utilization',
              avg_val: '0.45',
              points: [[1700000000000, 0.42], [1700000060000, 0.48]]
            }
          ];
        }
      };

      const fakeProblemStore = {
        list: async () => []
      };

      const app = express();
      app.use((req, res, next) => {
        req.sentinelEnv = 'staging';
        req.sentinelUser = { username: 'dev-user', roles: ['developer'] };
        next();
      });
      app.use('/api/v2/apps', createAppMapRouter({
        ch: fakeCh,
        yamlCfg: mockYamlConfig,
        probStore: fakeProblemStore,
        accessPolicy: { isEntitled: () => true }
      }));

      const server = http.createServer(app);
      const port = await listen(server);
      closers.push(() => server.close());

      const res = await fetchJson(`http://127.0.0.1:${port}/api/v2/apps/bitbucket/map`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.appId, 'bitbucket');
      assert.strictEqual(res.body.environment, 'staging');

      // Verify all 8 ordered layers exist
      const layerIds = res.body.layers.map(l => l.id);
      assert.deepStrictEqual(layerIds, [
        'users',
        'dns',
        'vip',
        'sso',
        'app_servers',
        'storage',
        'database',
        'dependencies'
      ]);

      // Check VIP node metrics
      const vipNode = res.body.nodes.find(n => n.kind === 'vip');
      assert(vipNode);
      assert.strictEqual(vipNode.status, 'HEALTHY');
      assert.strictEqual(vipNode.headline_metric.name, 'ttfb_ms');
      assert.strictEqual(vipNode.headline_metric.value, 78);
      assert.strictEqual(vipNode.reason, null);

      // Check unobserved layer (e.g. storage without data) -> null + reason DATA_UNAVAILABLE
      const storageNode = res.body.nodes.find(n => n.kind === 'storage');
      assert(storageNode);
      assert.strictEqual(storageNode.headline_metric, null);
      assert.strictEqual(storageNode.sparkline, null);
      assert.strictEqual(storageNode.reason, 'DATA_UNAVAILABLE');
      assert.strictEqual(storageNode.status, 'DATA_UNAVAILABLE');

      console.log('✔ Scenario 1: Ordered 8 layers returned with telemetry, and unobserved layer yields null + DATA_UNAVAILABLE');
    }

    // Scenario 2: Active Problem with top_layer = 'AVI/path'
    // Acceptance: AVI failing, later nodes affected_downstream
    {
      const fakeCh = {
        isConfigured: () => true,
        query: async () => [
          {
            entity_id: 'vip:bitbucket',
            metric_name: 'vip.total_ms',
            avg_val: '1850.0',
            points: [[1700000000000, 1850]]
          }
        ]
      };

      const fakeProblemStore = {
        list: async () => [
          {
            id: 'PRB-avi-slowdown',
            title: 'AVI Path Bottleneck on Bitbucket',
            top_layer: 'AVI/path',
            severity: 'CRITICAL',
            suspect_entity: 'app:bitbucket'
          }
        ]
      };

      const app = express();
      app.use((req, res, next) => {
        req.sentinelEnv = 'staging';
        req.sentinelUser = { username: 'sre-user', roles: ['sre'] };
        next();
      });
      app.use('/api/v2/apps', createAppMapRouter({
        ch: fakeCh,
        yamlCfg: mockYamlConfig,
        probStore: fakeProblemStore,
        accessPolicy: { isEntitled: () => true }
      }));

      const server = http.createServer(app);
      const port = await listen(server);
      closers.push(() => server.close());

      const res = await fetchJson(`http://127.0.0.1:${port}/api/v2/apps/bitbucket/map`);
      assert.strictEqual(res.status, 200);
      assert(res.body.open_problem);
      assert.strictEqual(res.body.open_problem.id, 'PRB-avi-slowdown');

      // VIP node should be failing
      const vipNode = res.body.nodes.find(n => n.layer === 'vip');
      assert.strictEqual(vipNode.status, 'failing');
      assert.strictEqual(vipNode.open_problem, true);

      // Prior nodes (users, dns) should NOT be affected_downstream
      const usersNode = res.body.nodes.find(n => n.layer === 'users');
      assert.notStrictEqual(usersNode.status, 'affected_downstream');
      const dnsNode = res.body.nodes.find(n => n.layer === 'dns');
      assert.notStrictEqual(dnsNode.status, 'affected_downstream');

      // Subsequent nodes (sso, app_servers, storage, database, dependencies) MUST be affected_downstream
      const ssoNode = res.body.nodes.find(n => n.layer === 'sso');
      assert.strictEqual(ssoNode.status, 'affected_downstream');

      const hostNodes = res.body.nodes.filter(n => n.layer === 'app_servers');
      for (const h of hostNodes) {
        assert.strictEqual(h.status, 'affected_downstream');
      }

      const storageNode = res.body.nodes.find(n => n.layer === 'storage');
      assert.strictEqual(storageNode.status, 'affected_downstream');

      const dbNode = res.body.nodes.find(n => n.layer === 'database');
      assert.strictEqual(dbNode.status, 'affected_downstream');

      const depNode = res.body.nodes.find(n => n.layer === 'dependencies');
      assert.strictEqual(depNode.status, 'affected_downstream');

      console.log('✔ Scenario 2: AVI slowdown correctly marks AVI failing and all downstream nodes affected_downstream');
    }

    // Scenario 3: Access control / forbidden environment -> returns 403
    {
      const app = express();
      app.use((req, res, next) => {
        req.sentinelEnv = 'prod';
        req.sentinelUser = { username: 'guest', roles: ['viewer'] };
        next();
      });
      app.use('/api/v2/apps', createAppMapRouter({
        ch: { isConfigured: () => false },
        yamlCfg: mockYamlConfig,
        accessPolicy: { isEntitled: () => false }
      }));

      const server = http.createServer(app);
      const port = await listen(server);
      closers.push(() => server.close());

      const res = await fetchJson(`http://127.0.0.1:${port}/api/v2/apps/bitbucket/map`);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.status, 'FORBIDDEN');
      console.log('✔ Scenario 3: Unauthorized environment request correctly returns 403');
    }

    // Scenario 4: Unknown application -> returns 404
    {
      const app = express();
      app.use((req, res, next) => {
        req.sentinelEnv = 'staging';
        req.sentinelUser = { username: 'dev-user', roles: ['developer'] };
        next();
      });
      app.use('/api/v2/apps', createAppMapRouter({
        ch: { isConfigured: () => false },
        yamlCfg: mockYamlConfig,
        accessPolicy: { isEntitled: () => true }
      }));

      const server = http.createServer(app);
      const port = await listen(server);
      closers.push(() => server.close());

      const res = await fetchJson(`http://127.0.0.1:${port}/api/v2/apps/unknown-app/map`);
      assert.strictEqual(res.status, 404);
      console.log('✔ Scenario 4: Non-existent application correctly returns 404');
    }

    console.log('=== ALL PHASE O5.1 APPLICATION MAP TESTS PASSED ===');
  } finally {
    for (const close of closers) {
      try { close(); } catch (_) {}
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
