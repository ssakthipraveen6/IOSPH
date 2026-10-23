/**
 * tests/demo_console.test.js
 * Observability-console demo fixtures: consistency between screens, coverage of all
 * monitored applications, and the read-only /api/demo/console/:screen route.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');

const fx = (n) => require(`../backend/demo/fixtures/console_${n}`);
const overview = fx('overview');
const jenkins = fx('jenkins');
const geo = fx('geo');
const compliance = fx('compliance');
const dependencies = fx('dependencies');
const reports = fx('reports');

const STATES = new Set(['ok', 'warn', 'crit']);

function get(port, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, raw: d }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // 1. Overview covers every real application manifest (17), once each.
  const appsDir = path.resolve(__dirname, '../config/apps');
  const manifestIds = fs.readdirSync(appsDir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('_'))
    .map(f => yaml.load(fs.readFileSync(path.join(appsDir, f), 'utf8')).id)
    .sort();
  const overviewIds = overview.groups.flatMap(g => g.apps.map(a => a.id)).sort();
  assert.strictEqual(manifestIds.length, 17, 'repo should have 17 application manifests');
  assert.deepStrictEqual(overviewIds, manifestIds, 'overview tiles must match the application manifests one to one');
  assert.strictEqual(overview.app_count, 17);
  console.log('✔ overview shows all 17 applications, matching config/apps');

  // 2. Every state value is one of ok / warn / crit.
  const states = [];
  const collect = (o) => {
    if (Array.isArray(o)) o.forEach(collect);
    else if (o && typeof o === 'object') {
      if (typeof o.state === 'string' && !['idle', 'busy', 'offline', 'maintenance'].includes(o.state) && !['met', 'degraded', 'outage'].includes(o.state)) states.push(o.state);
      Object.values(o).forEach(collect);
    }
  };
  [overview, jenkins, geo, compliance, dependencies, reports].forEach(collect);
  assert.ok(states.length > 50);
  states.forEach(s => assert.ok(STATES.has(s), `unexpected state '${s}'`));
  console.log('✔ all fixture states use ok / warn / crit');

  // 3. Jenkins estate: 5 OCs, 10 controllers, 250 static agents, totals derived from rows.
  assert.strictEqual(jenkins.operations_centers.length, 5);
  const ctrls = jenkins.operations_centers.flatMap(o => o.controllers);
  assert.strictEqual(ctrls.length, 10);
  const winCells = jenkins.windows_pools.flatMap(p => p.cells);
  const ubuCells = jenkins.ubuntu_agents.flatMap(o => o.cells);
  assert.strictEqual(winCells.length, 200);
  assert.strictEqual(ubuCells.length, 50);
  const online = [...winCells, ...ubuCells].filter(c => c.state !== 'offline').length;
  const kpiAgents = jenkins.kpis.find(k => k.label === 'Static agents online').value;
  assert.strictEqual(kpiAgents, `${online} / 250`, 'agent KPI must equal the cells shown');
  const kpiQueue = Number(jenkins.kpis.find(k => k.label === 'Build queue').value);
  assert.strictEqual(kpiQueue, ctrls.reduce((a, c) => a + c.queue, 0));
  jenkins.ubuntu_agents.forEach((oc, i) => {
    const o = jenkins.operations_centers[i];
    assert.strictEqual(o.ubuntu_agents.online, oc.cells.filter(c => c.state !== 'offline').length, `${o.id} Ubuntu count`);
  });
  const names = new Set([...winCells, ...ubuCells].map(c => c.name));
  assert.strictEqual(names.size, 250, 'agent names must be unique');
  console.log('✔ Jenkins: 5 OCs / 10 controllers / 250 agents, KPIs derived from the rows');

  // 4. Overview Jenkins tile and KPIs agree with the Jenkins screen.
  const jTile = overview.groups.flatMap(g => g.apps).find(a => a.id === 'cloudbees_jenkins');
  assert.strictEqual(jTile.metric.value, String(kpiQueue));
  assert.strictEqual(jTile.k2.value, kpiAgents);
  assert.strictEqual(jTile.drill, 'console-jenkins');
  console.log('✔ overview Jenkins tile matches the Jenkins drill-down');

  // 5. Geo: Artifactory 4+2 EMEA, 2+2 APAC/AMER; Bitbucket 15 EMEA, 5 + 5 mirrors.
  const r = Object.fromEntries(geo.regions.map(x => [x.id, x]));
  assert.deepStrictEqual([r.EMEA.artifactory.app.length, r.EMEA.artifactory.xray.length], [4, 2]);
  assert.deepStrictEqual([r.APAC.artifactory.app.length, r.APAC.artifactory.xray.length], [2, 2]);
  assert.deepStrictEqual([r.AMER.artifactory.app.length, r.AMER.artifactory.xray.length], [2, 2]);
  assert.deepStrictEqual([r.EMEA.bitbucket.nodes.length, r.APAC.bitbucket.nodes.length, r.AMER.bitbucket.nodes.length], [15, 5, 5]);
  assert.strictEqual(geo.lag_series.apac.length, geo.lag_series.points);
  console.log('✔ geo topology matches the estate (Artifactory 4+2 / 2+2 / 2+2, Bitbucket 15 / 5 / 5)');

  // 6. Compliance KPIs are derived from the tables.
  const k = Object.fromEntries(compliance.kpis.map(x => [x.label, x]));
  assert.strictEqual(Number(k['Expiring ≤ 30 days'].value), compliance.expiry.filter(e => e.days_left <= 30).length);
  assert.strictEqual(Number(k['Licences ≥ 85% used'].value), compliance.licences.filter(l => l.pct >= 85).length);
  assert.strictEqual(compliance.controller_drift.length, 10);
  compliance.expiry.forEach(e => assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date)));
  console.log('✔ compliance KPIs match their tables');

  // 7. Dependencies: probe KPI equals the cells with a last run.
  const cells = dependencies.probes.flatMap(p => p.results).filter(x => x.last);
  assert.strictEqual(dependencies.kpis[0].value, `${cells.filter(x => x.last === 'p').length} / ${cells.length}`);
  dependencies.probes.forEach(p => {
    assert.strictEqual(p.results.length, 3);
    p.results.forEach(x => assert.ok(x.history === '' || /^[psf]{12}$/.test(x.history)));
  });
  console.log('✔ dependencies probe matrix is well formed');

  // 8. Reports: one SLO per application, state follows the error budget, calendar has 30 days.
  assert.strictEqual(reports.slos.length, 17);
  reports.slos.forEach(s => {
    const expected = s.budget_pct <= 0 ? 'crit' : (s.budget_pct < 30 ? 'warn' : 'ok');
    assert.strictEqual(s.state, expected, `${s.app} SLO state`);
  });
  reports.calendar.forEach(c => assert.strictEqual(c.days.length, 30));
  assert.ok(reports.summary.includes(`${reports.slos.filter(s => s.state === 'ok').length} of 17`));
  console.log('✔ reports: 17 SLOs, states follow budget, 30-day calendars');

  // 9. Route: GET only, unknown screens 404, prototype keys do not leak.
  const demoRoutes = require('../backend/routes/demoRoutes');
  const app = express();
  app.use('/api/demo', demoRoutes);
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const port = server.address().port;
  try {
    for (const name of ['overview', 'jenkins', 'geo', 'compliance', 'dependencies', 'reports']) {
      const res = await get(port, `/api/demo/console/${name}`);
      assert.strictEqual(res.status, 200, name);
      assert.strictEqual(res.body.demo, true);
      assert.ok(res.body.data && typeof res.body.data === 'object');
    }
    assert.strictEqual((await get(port, '/api/demo/console/nope')).status, 404);
    assert.strictEqual((await get(port, '/api/demo/console/__proto__')).status, 404);
    assert.strictEqual((await get(port, '/api/demo/console/constructor')).status, 404);
    assert.strictEqual((await get(port, '/api/demo/console/overview', 'POST')).status, 405);
  } finally {
    server.close();
  }
  console.log('✔ /api/demo/console/:screen serves six screens, GET only, 404 for unknown');

  console.log('DEMO CONSOLE TESTS PASSED');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
