'use strict';
/**
 * The demo injection simulator: safe by default, deterministic, and its traffic fills the real views.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { hashKey } = require('../backend/auth/ingest_keys');
const sim = require('../scripts/simulate_demo_injection');

const ROOT = path.resolve(__dirname, '..');
const KEY = 'snk_sim_' + 'd'.repeat(40);
const quiet = () => {};

function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
}
async function waitUp(base, child, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try { const r = await fetch(`${base}/api/healthz`); if (r.ok) return; } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server did not start in time');
}

async function main() {
  // Unit: deterministic, phases, safety rails.
  const hosts = sim.hostNames(8);
  const apps = ['sonarqube', 'jfrog_artifactory'];
  const a = sim.buildRound({ env: 'staging', hosts, apps, elapsedMs: 60000, scenario: 'story', nowMs: 1700000000000 });
  const b = sim.buildRound({ env: 'staging', hosts, apps, elapsedMs: 60000, scenario: 'story', nowMs: 1700000000000 });
  assert.deepStrictEqual(a, b, 'same minute, same picture');
  assert.strictEqual(sim.phaseAt('story', 60000), 'steady');
  assert.strictEqual(sim.phaseAt('story', 3 * 60000), 'incident');
  assert.strictEqual(sim.phaseAt('story', 6 * 60000), 'recovery');
  assert.strictEqual(sim.phaseAt('story', 12.5 * 60000), 'incident', 'the story repeats every 10 minutes');
  const names = a.payload.resourceMetrics.flatMap(r => r.resource.attributes.filter(x => x.key === 'host.name').map(x => x.value.stringValue));
  assert.ok(names.every(n => /^sim-(lnx|win)-\d+\.demo\.local$/.test(n)), 'simulated hosts are recognisable');
  await assert.rejects(() => sim.run({ url: 'http://127.0.0.1:1', env: 'staging', log: quiet }), /ingest key is required/);
  await assert.rejects(() => sim.run({ url: 'http://127.0.0.1:1', key: KEY, env: 'prod', log: quiet }), /Refusing to send simulated data to prod/);

  // End to end: the simulator's traffic shows up in the real views, and the incident is visible.
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sim-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['backend/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', SENTINEL_RUNTIME_DIR: runtimeDir, SENTINEL_JWT_SECRET: 'sim-jwt-secret-' + 'x'.repeat(32), SENTINEL_INGEST_API_KEYS: `sim:staging:${hashKey(KEY)}:metrics;heartbeat`, SENTINEL_INGEST_AUTH_MODE: 'enforce' },
    stdio: 'ignore'
  });
  try {
    await waitUp(base, child);
    const login = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin_sentinel', password: 'Sim-Pass-1234' }) });
    const authed = { Authorization: `Bearer ${(await login.json()).token}` };
    const get = async (p) => (await fetch(`${base}${p}`, { headers: authed })).json();

    const result = await sim.run({ url: base, key: KEY, env: 'staging', hosts: 20, once: true, scenario: 'incident', log: quiet });
    assert.strictEqual(result.rounds, 1);

    const lnx = await get('/api/v2/infra/hosts?os=linux&environment=staging');
    const simHosts = lnx.hosts.filter(h => /^sim-lnx-/.test(h.host));
    assert.strictEqual(simHosts.length, 20, 'all simulated Linux hosts are listed');
    assert.ok(simHosts.every(h => typeof h.cpu_latest === 'number'), 'each shows CPU');
    assert.ok(simHosts.some(h => h.cpu_latest > 90), 'the incident hot hosts are visible');
    const win = await get('/api/v2/infra/hosts?os=windows&environment=staging');
    assert.strictEqual(win.hosts.filter(h => /^sim-win-/.test(h.host)).length, 5);
    const prodHosts = await get('/api/v2/infra/hosts?os=linux&environment=prod');
    assert.ok(!prodHosts.hosts.some(h => /^sim-/.test(h.host)), 'nothing reaches prod');

    const tiles = (await get('/api/v2/console/overview?environment=staging')).data.groups.flatMap(g => g.apps);
    const tile = (id) => tiles.find(t => t.id === id);
    assert.strictEqual(tile('sonarqube').state, 'ok', 'an application that is fine shows healthy');
    assert.notStrictEqual(tile('jfrog_artifactory').state, null, 'the hurt application reports numbers');
    const detail = (await get('/api/v2/console/app/jfrog_artifactory?environment=staging')).data;
    assert.ok(detail.metrics.find(m => m.name === 'responseTime').latest > 300, 'incident slows Artifactory down');
    console.log('demo_injection: all assertions passed');
  } finally {
    child.kill();
    try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
