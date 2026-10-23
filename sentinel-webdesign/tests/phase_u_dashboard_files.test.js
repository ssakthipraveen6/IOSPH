/**
 * tests/phase_u_dashboard_files.test.js
 *
 * U6: dashboards round-trip through config/dashboards/<slug>.json.
 * Files are read on start; POST /api/dashboards/:id/export writes the file.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-dash-'));
process.env.SENTINEL_DASHBOARDS_DIR = dir;
fs.writeFileSync(path.join(dir, 'seeded.json'), JSON.stringify({
  id: 'dash-seeded', slug: 'seeded', title: 'Seeded from file', environment: 'staging',
  panels: [{ type: 'stat', query: 'metrics where product = "artifactory"' }]
}));
fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');

const SERVICE = '../backend/services/dashboardService';

async function run() {
  console.log('=== PHASE U6: DASHBOARD FILE SYNC ===');
  const session = require('../backend/auth/session');
  session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');
  const svc = require(SERVICE);

  // Read on start; a broken file is skipped, not fatal.
  const seeded = await svc.getDashboard('seeded', 'staging');
  assert.ok(seeded, 'file dashboard loaded on start');
  assert.strictEqual(seeded.id, 'dash-seeded');
  assert.strictEqual(await svc.getDashboard('seeded', 'prod'), null, 'file keeps its environment');

  // Slugs are file names: no path traversal.
  const evil = svc.validateDashboard({ title: 'x', slug: '../../etc/passwd', panels: [] });
  assert.ok(/^[a-z0-9-]+$/.test(evil.slug), `slug sanitised: ${evil.slug}`);

  // Export through the API writes <slug>.json.
  const { app } = require('../backend/server');
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const lead = session.generateToken({ username: 'lead.sre@enterprise.corp', role: 'SRE Lead', environment: 'staging' });
  const sre = session.generateToken({ username: 'sre@enterprise.corp', role: 'SRE', environment: 'staging' });
  const post = (url, tok, body) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined
  });
  try {
    let res = await post('/api/dashboards', lead, { title: 'Round Trip', description: 'u6', tags: ['a'], panels: [{ type: 'time_series', query: 'metrics where product = "jenkins"' }] });
    assert.strictEqual(res.status, 201);
    const created = await res.json();

    res = await post(`/api/dashboards/${created.id}/export`, sre);
    assert.strictEqual(res.status, 403, 'SRE cannot write config files');
    res = await post(`/api/dashboards/${created.id}/export`, lead);
    assert.strictEqual(res.status, 200);
    const out = await res.json();
    assert.strictEqual(out.file, `config/dashboards/${created.slug}.json`);
    const file = path.join(dir, `${created.slug}.json`);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(
      { id: onDisk.id, title: onDisk.title, environment: onDisk.environment, panels: onDisk.panels.length, tags: onDisk.tags },
      { id: created.id, title: 'Round Trip', environment: 'staging', panels: 1, tags: ['a'] }
    );

    // A different dashboard may not take over that file.
    assert.throws(() => svc.writeDashboardFile({ ...onDisk, id: 'dash-other' }), e => e.status === 409);

    res = await post('/api/dashboards/no-such/export', lead);
    assert.strictEqual(res.status, 404);
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(r => server.close(r));
  }

  // Round trip: a fresh start reads the exported file back.
  delete require.cache[require.resolve(SERVICE)];
  const fresh = require(SERVICE);
  const back = await fresh.getDashboard('round-trip', 'staging');
  assert.ok(back, 'exported dashboard read back on the next start');
  assert.strictEqual(back.title, 'Round Trip');
  assert.strictEqual(back.panels[0].type, 'time_series');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✔ U6 dashboards load from files on start and export writes config/dashboards/<slug>.json');
}

run()
  .then(() => setTimeout(() => process.exit(0), 50))
  .catch(err => { console.error('U6 TEST FAILED:', err); setTimeout(() => process.exit(1), 50); });
