'use strict';
// Live observability console: real data only, honest empties, no sample values.
const assert = require('assert');
const http = require('http');
const express = require('express');
const { createConsoleRouter, buildOverview, buildJenkins, buildCompliance } = require('../backend/routes/consoleRoutes');

// --- builders ---
const none = buildOverview({ apps: {}, alerts: [], probe: () => null, nowMs: 0 });
assert.strictEqual(none.app_count, 0);

const apps = {
  bitbucket: { id: 'bitbucket', kind: 'application', display_name: 'Bitbucket', category: 'source_control', layers: { hosts: ['h1', 'h2'] } },
  sonarqube: { id: 'sonarqube', kind: 'application', category: 'code_quality' },
  off: { id: 'off', kind: 'application', enabled: false },
  bb_alias: { id: 'bitbucket', kind: 'application', display_name: 'Bitbucket', category: 'source_control' }
};
const ov = buildOverview({
  apps,
  alerts: [{ component: 'bitbucket', severity: 'Critical', status: 'Active', message: 'heap', timestamp: new Date().toISOString() }, { component: 'bitbucket', severity: 'Warning', status: 'Resolved', message: 'old' }],
  probe: id => (id === 'bb_alias' ? 'up' : (id === 'sonarqube' ? null : null)), nowMs: Date.now()
});
assert.strictEqual(ov.app_count, 2, 'disabled apps are left out and aliases are one tile');
const all = ov.groups.flatMap(g => g.apps);
assert.strictEqual(all.find(a => a.id === 'bitbucket').state, 'crit', 'open critical alert');
const down = buildOverview({ apps, alerts: [], probe: id => (id === 'sonarqube' ? 'down' : null), nowMs: Date.now() });
assert.strictEqual(down.groups.flatMap(g => g.apps).find(a => a.id === 'sonarqube').state, 'crit', 'failing probe is shown as degraded');
const up = buildOverview({ apps, alerts: [], probe: id => (id === 'sonarqube' ? 'up' : null), nowMs: Date.now() });
assert.strictEqual(up.groups.flatMap(g => g.apps).find(a => a.id === 'sonarqube').state, 'ok');
assert.strictEqual(all.find(a => a.id === 'sonarqube').state, null, 'no telemetry = unknown, never healthy');
assert.strictEqual(all.find(a => a.id === 'sonarqube').metric.value, '—');
assert.strictEqual(ov.alerts.length, 1, 'resolved alerts are not listed');
assert.deepStrictEqual(ov.chain, []);
assert.strictEqual(ov.chart, null);

assert.strictEqual(buildJenkins(null), null);
assert.strictEqual(buildJenkins({ declared: 0, controllers: [] }), null);
const jk = buildJenkins({
  polled_at: 't', declared: 2, answered: 1, auth_failed: 1,
  totals: { queue: 3, executors_busy: 4, executors_total: 4, agents_online: 1, agents_offline: 1 },
  controllers: [
    { id: 'c1', oc: 'OC-1', status: 'OK', queue: { length: 3, oldest_wait_s: 700 }, executors: { busy: 4, total: 4 }, computers: [{ name: 'a1', offline: false, idle: true }, { name: 'a2', offline: true }] },
    { id: 'c2', oc: 'OC-1', status: 'AUTH_FAILED', error: '401', queue: null, executors: null, computers: [] }
  ]
});
const ctl = jk.operations_centers[0].controllers;
assert.strictEqual(ctl[0].state, 'crit', 'all executors busy');
assert.strictEqual(ctl[1].state, 'crit', 'refused token is shown as failing');
assert.strictEqual(ctl[0].heap_pct, null, 'heap is not measured, so null');
assert.deepStrictEqual(jk.build_clusters, []);
assert.deepStrictEqual(jk.agents[0].cells.map(c => c.state), ['idle', 'offline']);
assert.strictEqual(jk.queue[0].hot, true);

assert.strictEqual(buildCompliance([]), null);
const cp = buildCompliance([
  { name: 'vip-tls', kind: 'tls_cert', product: 'sonar', daysLeft: 12, not_after: '2026-11-03T00:00:00Z' },
  { name: 'L', kind: 'license', product: 'tc', daysLeft: 100, not_after: '2027-01-01T00:00:00Z', seats_total: 100, seats_used: 90 },
  { name: 'nodate', kind: 'tls_cert', product: 'x', daysLeft: null }
]);
assert.strictEqual(cp.expiry.length, 2, 'items without a date are not listed');
assert.strictEqual(cp.expiry[0].days_left, 12);
assert.strictEqual(cp.licences[0].pct, 90);
assert.deepStrictEqual(cp.versions, []);

// --- HTTP ---
function get(port, path) {
  return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, res => {
    let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
  }).on('error', reject));
}
(async () => {
  let snapshot = null;
  const app = express();
  app.use((req, _res, next) => { req.sentinelEnv = 'prod'; next(); });
  app.use('/api/v2/console', createConsoleRouter({
    yamlConfig: { loadAllApplications: () => apps },
    db: { getAlerts: () => [], getMetrics: () => [] },
    expiryStore: { getExpiryItems: async () => [] },
    jenkinsTopology: { getLastSnapshot: () => snapshot }
  }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  try {
    for (const s of ['geo', 'dependencies', 'reports', 'jenkins', 'compliance']) {
      const r = await get(port, `/api/v2/console/${s}`);
      assert.strictEqual(r.body.status, 'DATA_UNAVAILABLE', `${s} has no source yet`);
      assert.ok(r.body.reason && r.body.reason.length > 10);
    }
    const o = await get(port, '/api/v2/console/overview');
    assert.strictEqual(o.body.data.app_count, 2);
    assert.strictEqual(o.body.data.groups.flatMap(g => g.apps).every(a => a.state === null), true, 'nothing reporting = all unknown');
    assert.strictEqual((await get(port, '/api/v2/console/nope')).status, 404);
    snapshot = { polled_at: 't', declared: 1, answered: 1, auth_failed: 0, totals: { queue: 0, executors_busy: 0, executors_total: 2, agents_online: 0, agents_offline: 0 }, controllers: [{ id: 'c1', oc: 'OC-1', status: 'OK', queue: { length: 0, oldest_wait_s: 0 }, executors: { busy: 0, total: 2 }, computers: [] }] };
    const j = await get(port, '/api/v2/console/jenkins');
    assert.strictEqual(j.body.data.operations_centers[0].controllers[0].state, 'ok');
    console.log('console_live: all assertions passed');
  } finally { srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
