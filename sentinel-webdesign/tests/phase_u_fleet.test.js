/**
 * tests/phase_u_fleet.test.js
 *
 * U2 — Fleet view API (GET /api/v2/fleet/overview, backend/routes/fleetRoutes.js):
 *  - pure shaping: version distribution, last seen, coverage with and without
 *    fleet.expected_hosts, drift and silent states, DATA_UNAVAILABLE without hosts;
 *  - through the router on a small express app, with hosts seeded the way the
 *    heartbeat endpoint writes them and drift written by the real P10 job
 *    (runFleetHealth) against an in-memory inventory;
 *  - the real @sentinel/inventory store: a seeded heartbeat host appears;
 *  - environment comes from req.sentinelEnv (fallback 'staging').
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const fleetRoutes = require('../backend/routes/fleetRoutes');
const { shapeFleetOverview, createFleetRouter, readExpectedHosts, driftState } = fleetRoutes;
const { runFleetHealth } = require('../backend/jobs/fleet_health');
const { renderAgentConfig } = require('../backend/routes/agentRoutes');

const uid = Date.now().toString(36);
const NOW = Date.parse('2026-10-12T10:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** The labels POST /api/v2/shipper/heartbeat writes. */
function heartbeatEntity(name, env, { version, os = 'linux', hash = null, at }) {
  return {
    entity_id: `host:${name}`, kind: 'host', name, environment: env, status: 'HEALTHY',
    labels: { shipper_version: version, agent_version: version, config_hash: hash, os, last_heartbeat: at, heartbeat_status: 'ALIVE' }
  };
}

/** In-memory inventory with the store's label-merging upsert. */
function memoryInventory() {
  const map = new Map();
  return {
    map,
    async upsertEntity(e) {
      const prev = map.get(e.entity_id);
      map.set(e.entity_id, { ...(prev || {}), ...e, labels: { ...((prev && prev.labels) || {}), ...(e.labels || {}) } });
    },
    async getEntities({ kind, environment } = {}) {
      const entities = [...map.values()].filter(e => (!kind || e.kind === kind) && (!environment || e.environment === environment));
      return { entities, total: entities.length };
    }
  };
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function appWith(router, env) {
  const app = express();
  app.use((req, _res, next) => { if (env) req.sentinelEnv = env; next(); });
  app.use('/api/v2/fleet', router);
  return app;
}

async function get(server, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { status: res.status, body: await res.json() };
}

async function run() {
  console.log('=== RUNNING PHASE U2: FLEET VIEW TESTS ===');
  const closers = [];
  try {
    // ------------------------------------------------------------ pure shaping
    const entities = [
      heartbeatEntity('u2-a', 'staging', { version: '1.2.0', hash: 'h1', at: iso(30 * 1000) }),
      heartbeatEntity('u2-b', 'staging', { version: '1.2.0', hash: 'h2', at: iso(10 * 60 * 1000) }),
      heartbeatEntity('u2-c', 'staging', { version: '1.1.0', hash: 'h3', at: iso(5 * 1000), os: 'windows' }),
      heartbeatEntity('u2-d', 'staging', { version: null, at: iso(60 * 1000) }),
      { entity_id: 'host:u2-noagent', kind: 'host', name: 'u2-noagent', environment: 'staging', labels: {}, last_seen: iso(3600 * 1000) },
      { entity_id: 'db:u2-x', kind: 'database', name: 'u2-x', environment: 'staging', labels: {} }
    ];
    entities[0].labels.expected_config_hash = 'h1';               // in sync per P10
    entities[1].labels.expected_config_hash = 'other';            // drifted per P10
    entities[2].labels.config_drift = true;                        // drift flag only

    const shaped = shapeFleetOverview({ entities, environment: 'staging', expectedHosts: 10, silentAfterSeconds: 300, nowMs: NOW });
    assert.strictEqual(shaped.status, 'OK');
    assert.strictEqual(shaped.environment, 'staging');
    assert.strictEqual(shaped.hosts.length, 5, 'non-host entities are excluded');
    assert.deepStrictEqual(shaped.summary.version_distribution, [
      { version: '1.2.0', count: 2 }, { version: '1.1.0', count: 1 }, { version: null, count: 1 }
    ]);
    const byName = Object.fromEntries(shaped.hosts.map(h => [h.host, h]));
    assert.strictEqual(byName['u2-a'].last_seen, iso(30 * 1000), 'last seen = last heartbeat');
    assert.strictEqual(byName['u2-a'].heartbeat_age_seconds, 30);
    assert.strictEqual(byName['u2-noagent'].last_seen, iso(3600 * 1000), 'no agent: entity last_seen');
    assert.strictEqual(byName['u2-noagent'].has_agent, false);
    assert.strictEqual(byName['u2-noagent'].silent, null);
    assert.strictEqual(byName['u2-a'].silent, false);
    assert.strictEqual(byName['u2-b'].silent, true, '10 min without heartbeat is silent');
    assert.strictEqual(byName['u2-a'].drift, 'in_sync');
    assert.strictEqual(byName['u2-a'].drift_source, 'p10');
    assert.strictEqual(byName['u2-b'].drift, 'drifted');
    assert.strictEqual(byName['u2-c'].drift, 'drifted');
    assert.strictEqual(byName['u2-d'].drift, 'unknown', 'no config hash reported');
    assert.strictEqual(byName['u2-c'].os, 'windows');
    const sum = shaped.summary;
    assert.strictEqual(sum.hosts_total, 5);
    assert.strictEqual(sum.agents_total, 4);
    assert.strictEqual(sum.silent, 1);
    assert.strictEqual(sum.reporting, 3);
    assert.strictEqual(sum.drifted, 2);
    assert.strictEqual(sum.in_sync, 1);
    assert.strictEqual(sum.drift_unknown, 1);
    assert.strictEqual(sum.last_seen, iso(5 * 1000), 'fleet last seen = newest heartbeat');
    assert.deepStrictEqual(sum.coverage, { reporting: 3, expected: 10, pct: 30 });

    const noExpected = shapeFleetOverview({ entities, environment: 'staging', expectedHosts: null, nowMs: NOW });
    assert.deepStrictEqual(noExpected.summary.coverage, { reporting: 3, expected: null, pct: null }, 'coverage unknown without expected_hosts');

    const empty = shapeFleetOverview({ entities: [], environment: 'prod', expectedHosts: 10, nowMs: NOW });
    assert.strictEqual(empty.status, 'DATA_UNAVAILABLE');
    assert.ok(empty.reason);
    assert.deepStrictEqual(empty.hosts, []);
    assert.strictEqual(empty.summary, null);

    assert.strictEqual(readExpectedHosts({ fleet: { expected_hosts: 215 } }), 215);
    assert.strictEqual(readExpectedHosts({ fleet: { expected_hosts: '' } }), null);
    assert.strictEqual(readExpectedHosts({ fleet: { expected_hosts: 0 } }), null);
    assert.strictEqual(readExpectedHosts({}), null);
    assert.deepStrictEqual(driftState({}), { state: 'unknown', source: null });
    assert.deepStrictEqual(driftState({ config_hash: 'x' }, 'x'), { state: 'in_sync', source: 'served_config' });
    assert.deepStrictEqual(driftState({ config_hash: 'x' }, 'y'), { state: 'drifted', source: 'served_config' });
    assert.deepStrictEqual(driftState({ config_hash: 'x', expected_config_hash: 'y' }, 'x'), { state: 'drifted', source: 'p10' }, 'P10 label wins');
    // A host P10 has not labelled: compared with the served hash, as P10 does.
    const unlabelled = shapeFleetOverview({ entities: [heartbeatEntity('u2-e', 'staging', { version: '1.0.0', hash: 'served', at: iso(1000) })], environment: 'staging', nowMs: NOW, render: () => ({ config_hash: 'served' }) });
    assert.strictEqual(unlabelled.hosts[0].drift, 'in_sync');
    assert.strictEqual(unlabelled.hosts[0].drift_source, 'served_config');
    console.log('✔ Shaping: version distribution, last seen, silent/drift states, coverage with and without expected_hosts, empty state.');

    // ------------------------------------------------------------ router + real P10 job on an in-memory inventory
    const inv = memoryInventory();
    const ok = `u2ok${uid}`, drift = `u2drift${uid}`, silent = `u2silent${uid}`, prodHost = `u2prod${uid}`;
    const realNow = Date.now();
    const goodHash = renderAgentConfig({ host: ok, os: 'linux', agentVersion: '2.0.0', env: 'staging' }).config_hash;
    await inv.upsertEntity(heartbeatEntity(ok, 'staging', { version: '2.0.0', hash: goodHash, at: new Date(realNow).toISOString() }));
    await inv.upsertEntity(heartbeatEntity(drift, 'staging', { version: '2.0.0', hash: 'deadbeef'.repeat(8), at: new Date(realNow).toISOString() }));
    await inv.upsertEntity(heartbeatEntity(silent, 'staging', { version: '1.9.0', at: new Date(realNow - 6 * 60000).toISOString() }));
    await inv.upsertEntity(heartbeatEntity(prodHost, 'prod', { version: '2.0.0', at: new Date(realNow).toISOString() }));

    const fakeStore = { getAlerts: () => [], addAlert: () => null };
    const p10 = await runFleetHealth({ environments: ['staging'], store: fakeStore, inv, nowMs: realNow });
    assert.strictEqual(p10.staging.drifted, 1);
    assert.strictEqual(p10.staging.silent, 1);

    const routerCfg = { inv, now: () => realNow, loadJobs: () => ({ fleet_health: { silent_after_seconds: 300 } }) };
    const withExpected = await listen(appWith(createFleetRouter({ ...routerCfg, loadGlobal: () => ({ fleet: { expected_hosts: 4 } }) }), 'staging'));
    closers.push(() => withExpected.close());
    const r1 = await get(withExpected, '/api/v2/fleet/overview');
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.body.status, 'OK');
    assert.strictEqual(r1.body.environment, 'staging');
    assert.strictEqual(r1.body.hosts.length, 3, 'only the session environment');
    const h = Object.fromEntries(r1.body.hosts.map(x => [x.host, x]));
    assert.strictEqual(h[ok].drift, 'in_sync', 'matching hash (P10 leaves no label on an always-in-sync host)');
    assert.strictEqual(h[ok].drift_source, 'served_config');
    assert.strictEqual(h[drift].drift_source, 'p10');
    assert.strictEqual(h[drift].drift, 'drifted', 'P10 output: drift');
    assert.strictEqual(h[silent].silent, true);
    assert.strictEqual(h[ok].silent, false);
    assert.strictEqual(h[silent].drift, 'unknown', 'no reported config hash');
    assert.deepStrictEqual(r1.body.summary.version_distribution, [{ version: '2.0.0', count: 2 }, { version: '1.9.0', count: 1 }]);
    assert.deepStrictEqual(r1.body.summary.coverage, { reporting: 2, expected: 4, pct: 50 });
    assert.strictEqual(r1.body.summary.drifted, 1);
    assert.strictEqual(r1.body.summary.silent, 1);

    const noExp = await listen(appWith(createFleetRouter({ ...routerCfg, loadGlobal: () => ({}) }), null));
    closers.push(() => noExp.close());
    const r2 = await get(noExp, '/api/v2/fleet/overview');
    assert.strictEqual(r2.body.environment, 'staging', 'falls back to staging without req.sentinelEnv');
    assert.deepStrictEqual(r2.body.summary.coverage, { reporting: 2, expected: null, pct: null });

    const prodApp = await listen(appWith(createFleetRouter({ ...routerCfg, loadGlobal: () => ({}) }), 'prod'));
    closers.push(() => prodApp.close());
    const r3 = await get(prodApp, '/api/v2/fleet/overview');
    assert.strictEqual(r3.body.environment, 'prod');
    assert.deepStrictEqual(r3.body.hosts.map(x => x.host), [prodHost]);

    const emptyApp = await listen(appWith(createFleetRouter({ ...routerCfg, inv: memoryInventory(), loadGlobal: () => ({ fleet: { expected_hosts: 4 } }) }), 'staging'));
    closers.push(() => emptyApp.close());
    const r4 = await get(emptyApp, '/api/v2/fleet/overview');
    assert.strictEqual(r4.status, 200);
    assert.strictEqual(r4.body.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(r4.body.environment, 'staging');
    assert.ok(typeof r4.body.reason === 'string' && r4.body.reason.length > 0);
    assert.deepStrictEqual(r4.body.hosts, []);
    console.log('✔ Router: hosts seeded as heartbeats, drift from the real P10 job, silent state, coverage with/without expected_hosts, env isolation, DATA_UNAVAILABLE.');

    // ------------------------------------------------------------ default router on the real inventory store + global.yaml
    const inventory = require('@sentinel/inventory');
    const realHost = `u2real${uid}`;
    await inventory.upsertEntity(heartbeatEntity(realHost, 'staging', { version: '3.0.0', hash: null, at: new Date().toISOString() }));
    const realApp = await listen(appWith(fleetRoutes, 'staging'));
    closers.push(() => realApp.close());
    const r5 = await get(realApp, '/api/v2/fleet/overview');
    assert.strictEqual(r5.body.status, 'OK');
    const seeded = r5.body.hosts.find(x => x.host === realHost);
    assert.ok(seeded, 'seeded heartbeat host appears');
    assert.strictEqual(seeded.agent_version, '3.0.0');
    assert.strictEqual(seeded.has_agent, true);
    assert.ok(r5.body.summary.version_distribution.some(v => v.version === '3.0.0'));
    const expectedHosts = readExpectedHosts(require('../backend/jobs/job_config').getGlobal());
    assert.strictEqual(r5.body.summary.coverage.expected, expectedHosts, 'coverage uses fleet.expected_hosts from global.yaml');
    console.log(`✔ Default router on the real inventory store (fleet.expected_hosts = ${expectedHosts}).`);

    console.log('=== PHASE U2 FLEET VIEW TESTS PASSED ===');
  } finally {
    for (const c of closers) { try { c(); } catch (_) {} }
    await new Promise(r => setTimeout(r, 100));
  }
}

run()
  .then(() => setTimeout(() => process.exit(0), 50))
  .catch((err) => { console.error('✘ Phase U2 fleet test failed:', err); setTimeout(() => process.exit(1), 50); });
