'use strict';
/**
 * E2E: dummy data sent to PRD and STG through the real ingest endpoints.
 *
 * One server, two ingest keys (one per environment). Checks that each environment's
 * views show only what was sent to it, at fleet scale (200 hosts each), that odd
 * payloads are rejected without hurting the server, and that the console shows the
 * right state per application (healthy, degraded by a failing probe, unknown).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { hashKey } = require('../backend/auth/ingest_keys');

const ROOT = path.resolve(__dirname, '..');
const KEYS = { prod: 'snk_prod_' + 'p'.repeat(40), staging: 'snk_stg_' + 's'.repeat(40) };
const N = 200;
const SONAR_HOST = 'sonarqube-node-01.internal.corp';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
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
const now = () => String(BigInt(Date.now()) * 1000000n);
const gauge = (name, value, attrs = []) => ({ name, gauge: { dataPoints: [{ asDouble: value, timeUnixNano: now(), attributes: attrs }] } });
const str = (key, stringValue) => ({ key, value: { stringValue } });
const hostRes = (host, env, cpu, mem, disk) => ({
  resource: { attributes: [str('host.name', host), str('deployment.environment', env)] },
  scopeMetrics: [{ metrics: [gauge('system.cpu.utilization', cpu), gauge('system.memory.utilization', mem), gauge('system.filesystem.utilization', disk, [str('mountpoint', '/')])] }]
});
const appRes = (appId, env, vals) => ({
  resource: { attributes: [str('application.id', appId), str('deployment.environment', env)] },
  scopeMetrics: [{ metrics: Object.entries(vals).map(([k, v]) => gauge(k, v)) }]
});

async function main() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-e2e-both-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['backend/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development',
      SENTINEL_RUNTIME_DIR: runtimeDir, SENTINEL_JWT_SECRET: 'e2e-jwt-secret-' + 'x'.repeat(32),
      SENTINEL_INGEST_API_KEYS: `e2e-prod:prod:${hashKey(KEYS.prod)}:metrics;heartbeat,e2e-stg:staging:${hashKey(KEYS.staging)}:metrics;heartbeat`,
      SENTINEL_INGEST_AUTH_MODE: 'enforce'
    },
    stdio: 'ignore'
  });
  try {
    await waitUp(base, child);
    const login = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin_sentinel', password: 'E2e-Pass-1234' }) });
    assert.strictEqual(login.status, 200);
    const authed = { Authorization: `Bearer ${(await login.json()).token}` };
    const get = async (p) => { const r = await fetch(`${base}${p}`, { headers: authed }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const post = (p, env, body, raw) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': KEYS[env] }, body: raw !== undefined ? raw : JSON.stringify(body) });

    // Empty first: both environments start without hosts or application numbers.
    for (const env of ['prod', 'staging']) {
      const h = await get(`/api/v2/infra/hosts?os=linux&environment=${env}`);
      assert.ok(!(h.body.hosts || []).some(x => /^dummy-/.test(x.host)), `${env} starts without dummy hosts`);
      const o = await get(`/api/v2/console/overview?environment=${env}`);
      assert.ok(o.body.data.groups.flatMap(g => g.apps).every(a => a.state === null || a.state === 'ok' || a.state === 'crit'));
    }

    // Send: N linux hosts + 2 windows hosts per env. Values differ per env so a leak is visible.
    const profile = { prod: { cpu: 0.2, mem: 0.4, disk: 0.5 }, staging: { cpu: 0.8, mem: 0.7, disk: 0.9 } };
    for (const env of ['prod', 'staging']) {
      const p = profile[env];
      const resources = [];
      for (let i = 0; i < N; i++) {
        const host = `dummy-${env}-lnx-${String(i).padStart(3, '0')}.internal.corp`;
        const hb = await post('/api/v2/shipper/heartbeat', env, { host, version: '2.4.0', os: 'linux', config_hash: 'h1' });
        assert.strictEqual(hb.status, 200, `${env} heartbeat ${i}`);
        resources.push(hostRes(host, env, p.cpu, p.mem, p.disk));
      }
      for (let i = 0; i < 2; i++) {
        const host = `dummy-${env}-win-${i}.internal.corp`;
        assert.strictEqual((await post('/api/v2/shipper/heartbeat', env, { host, version: '2.4.0', os: 'windows', config_hash: 'h1' })).status, 200);
        resources.push(hostRes(host, env, p.cpu, p.mem, p.disk));
      }
      // The SonarQube manifest host reports in prod only: a host name is one entity, so the same name in two environments would collide.
      if (env === 'prod') {
        assert.strictEqual((await post('/api/v2/shipper/heartbeat', env, { host: SONAR_HOST, version: '2.4.0', os: 'linux', config_hash: 'h1' })).status, 200);
        resources.push(hostRes(SONAR_HOST, env, p.cpu, p.mem, p.disk));
      }
      // Application numbers: sonarqube healthy in prod, failing in staging; argocd healthy in both; nexusiq sends nothing.
      resources.push(appRes('sonarqube', env, env === 'prod' ? { responseTime: 120, successRate: 100, requests: 50 } : { responseTime: 3000, successRate: 0, requests: 2 }));
      resources.push(appRes('argocd', env, { responseTime: 80, successRate: 100 }));
      const push = await post('/v1/metrics', env, { resourceMetrics: resources });
      assert.strictEqual(push.status, 200, `${env} bulk metrics accepted`);
      assert.ok((await push.json()).count >= (N + 2) * 3, `${env} all points counted`);
    }

    // A key for one environment cannot write into the other, whatever the payload claims.
    assert.strictEqual((await post('/v1/metrics', 'staging', { resourceMetrics: [hostRes('dummy-leak-01.internal.corp', 'prod', 0.99, 0.99, 0.99)] })).status, 200);

    // Odd payloads: refused or ignored, never a crash.
    for (const raw of ['', '{', 'null', '[]', JSON.stringify({ resourceMetrics: 'x' }), JSON.stringify({ resourceMetrics: [{ resource: {}, scopeMetrics: [{ metrics: [gauge('system.cpu.utilization', 'NaN')] }] }] })]) {
      const r = await post('/v1/metrics', 'staging', null, raw);
      assert.ok(r.status < 500, `odd payload ${JSON.stringify(raw).slice(0, 30)} handled (${r.status})`);
    }
    assert.strictEqual((await fetch(`${base}/api/healthz`)).status, 200, 'server still healthy');

    for (const env of ['prod', 'staging']) {
      const p = profile[env];
      const other = env === 'prod' ? 'staging' : 'prod';
      // Linux view
      const lnx = await get(`/api/v2/infra/hosts?os=linux&environment=${env}`);
      assert.strictEqual(lnx.status, 200);
      const mine = lnx.body.hosts.filter(h => h.host.startsWith(`dummy-${env}-lnx-`));
      assert.strictEqual(mine.length, N, `${env} Linux view lists all ${N} hosts`);
      assert.ok(mine.every(h => Math.abs(h.cpu_latest - p.cpu * 100) < 0.5 && Math.abs(h.memory_latest - p.mem * 100) < 0.5 && Math.abs(h.worst_filesystem_pct - p.disk * 100) < 0.5), `${env} values are the ones sent to ${env}`);
      assert.ok(!lnx.body.hosts.some(h => h.host.startsWith(`dummy-${other}-`) || (env === 'prod' && h.host.startsWith('dummy-leak'))), `${env} shows nothing sent to ${other}; a staging key cannot create prod entities`);
      // Windows view
      const win = await get(`/api/v2/infra/hosts?os=windows&environment=${env}`);
      assert.strictEqual(win.body.hosts.filter(h => h.host.startsWith(`dummy-${env}-win-`)).length, 2, `${env} Windows view lists its 2 hosts`);
      assert.ok(!win.body.hosts.some(h => h.host.startsWith('dummy-') && h.os !== 'windows'), `${env} Windows view has no Linux hosts`);
      // Fleet
      const fleet = await get(`/api/v2/fleet/overview?environment=${env}`);
      assert.ok(fleet.body.summary.coverage.reporting >= N + 2, `${env} fleet counts the agents (${fleet.body.summary.coverage.reporting})`);
      // Metrics API
      const m = await get(`/api/metrics?environment=${env}&limit=5000`);
      assert.ok(Array.isArray(m.body) && m.body.every(x => !x.env || x.env === env), `${env} metrics carry only ${env}`);
    }

    // Console: per-application state follows what was sent.
    const stateOf = async (env, id) => (await get(`/api/v2/console/overview?environment=${env}`)).body.data.groups.flatMap(g => g.apps).find(a => a.id === id);
    assert.strictEqual((await stateOf('prod', 'sonarqube')).state, 'ok', 'prod SonarQube healthy');
    assert.strictEqual((await stateOf('staging', 'sonarqube')).state, 'crit', 'staging SonarQube failing probe');
    assert.strictEqual((await stateOf('prod', 'argocd')).state, 'ok');
    assert.strictEqual((await stateOf('prod', 'nexusiq')).state, null, 'no numbers sent = unknown, not healthy');
    const detail = await get('/api/v2/console/app/sonarqube?environment=staging');
    assert.strictEqual(detail.status, 200);
    const rt = detail.body.data.metrics.find(x => x.name === 'responseTime');
    assert.strictEqual(rt.latest, 3000, 'staging detail shows the staging value');
    assert.strictEqual(detail.body.data.state, 'crit');
    assert.strictEqual((await get('/api/v2/console/app/sonarqube?environment=prod')).body.data.metrics.find(x => x.name === 'responseTime').latest, 120);
    assert.strictEqual((await get('/api/v2/console/app/nope?environment=prod')).status, 404);

    // Ingest health responds.
    const ih = await get('/api/v2/ingest/health?environment=prod');
    assert.strictEqual(ih.status, 200);

    console.log(`✔ ${N + 2}+ hosts x 2 environments ingested; Linux, Windows, Fleet, Metrics and Console views stay separate and correct; odd payloads never crash the server`);
    console.log('E2E INGEST BOTH ENVIRONMENTS TESTS PASSED');
  } finally {
    child.kill();
    try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
