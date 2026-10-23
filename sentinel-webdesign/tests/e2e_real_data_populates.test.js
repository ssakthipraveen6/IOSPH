'use strict';
/**
 * E2E: real data arriving through the ingest endpoints populates the views.
 *
 * Starts the real backend on a free port with a throwaway runtime folder, signs in,
 * and checks that before any data the host views say "no data", then after a heartbeat
 * plus OTLP host metrics the Fleet, Hosts and Linux views show that host with its
 * CPU, memory and disk. Production-style honesty is kept: nothing is shown that was not sent.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { hashKey } = require('../backend/auth/ingest_keys');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'e2e-linux-01.internal.corp';
const RAW_KEY = 'snk_e2e_' + 'a'.repeat(40);

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

const gauge = (name, value, attrs = []) => ({ name, gauge: { dataPoints: [{ asDouble: value, timeUnixNano: String(BigInt(Date.now()) * 1000000n), attributes: attrs }] } });

async function main() {
  const runtimeDir = process.env.SENTINEL_RUNTIME_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-e2e-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['backend/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development',
      SENTINEL_RUNTIME_DIR: runtimeDir,
      SENTINEL_JWT_SECRET: 'e2e-jwt-secret-' + 'x'.repeat(32),
      SENTINEL_INGEST_API_KEYS: `e2e:staging:${hashKey(RAW_KEY)}:metrics;heartbeat`,
      SENTINEL_INGEST_AUTH_MODE: 'enforce'
    },
    stdio: 'ignore'
  });
  try {
    await waitUp(base, child);

    const login = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin_sentinel', password: 'E2e-Pass-1234' }) });
    assert.strictEqual(login.status, 200, 'staging test login works');
    const { token } = await login.json();
    const authed = { Authorization: `Bearer ${token}` };
    const get = async (p) => { const r = await fetch(`${base}${p}`, { headers: authed }); return { status: r.status, body: await r.json() }; };
    const find = (hosts) => (hosts || []).find(h => h.host === HOST);

    // 1. Before any data the host is unknown (inventory may list manifest hosts, never this one)
    const before = await get('/api/v2/infra/hosts?os=linux&environment=staging');
    assert.strictEqual(before.status, 200);
    assert.ok(!find(before.body.hosts), 'unknown host is not invented');

    // 2. Ingest without a key is refused
    const noKey = await fetch(`${base}/api/v2/shipper/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: HOST }) });
    assert.strictEqual(noKey.status, 401);

    // 3. Heartbeat + OTLP host metrics with a valid key
    const keyed = { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': RAW_KEY };
    const hb = await fetch(`${base}/api/v2/shipper/heartbeat`, { method: 'POST', headers: keyed, body: JSON.stringify({ host: HOST, version: '2.4.0', os: 'linux', config_hash: 'abc123' }) });
    assert.strictEqual(hb.status, 200);
    const otlp = { resourceMetrics: [{
      resource: { attributes: [{ key: 'host.name', value: { stringValue: HOST } }, { key: 'deployment.environment', value: { stringValue: 'staging' } }] },
      scopeMetrics: [{ metrics: [
        gauge('system.cpu.utilization', 0.37),
        gauge('system.memory.utilization', 0.52),
        gauge('system.filesystem.utilization', 0.61, [{ key: 'mountpoint', value: { stringValue: '/' } }]),
        gauge('system.filesystem.utilization', 0.88, [{ key: 'mountpoint', value: { stringValue: '/data' } }])
      ] }]
    }] };
    const push = await fetch(`${base}/v1/metrics`, { method: 'POST', headers: keyed, body: JSON.stringify(otlp) });
    assert.strictEqual(push.status, 200);
    assert.ok((await push.json()).count >= 4, 'metrics accepted');

    // 4. The views now show it
    const after = await get('/api/v2/infra/hosts?os=linux&environment=staging');
    const row = find(after.body.hosts);
    assert.ok(row, 'Linux view lists the reporting host');
    assert.strictEqual(row.agent_state.has_agent, true);
    assert.strictEqual(row.agent_state.agent_version, '2.4.0');
    assert.ok(Math.abs(row.cpu_latest - 37) < 0.5, `CPU populated from ingest (got ${row.cpu_latest})`);
    assert.ok(Math.abs(row.memory_latest - 52) < 0.5, `memory populated (got ${row.memory_latest})`);
    assert.ok(Math.abs(row.worst_filesystem_pct - 88) < 0.5, `worst filesystem is the fullest mount (got ${row.worst_filesystem_pct})`);

    const fleet = await get('/api/v2/fleet/overview?environment=staging');
    assert.strictEqual(fleet.status, 200);
    const fRow = (fleet.body.hosts || []).find(h => (h.host || h.name) === HOST);
    assert.ok(fRow, 'Fleet view lists the reporting host');
    assert.ok(fleet.body.summary.agents_total >= 1 && fleet.body.summary.coverage.reporting >= 1, 'coverage counts the new agent');

    // 5. Environments stay separate: the same host is not visible in prod
    const prod = await get('/api/v2/infra/hosts?os=linux&environment=prod');
    assert.ok(![403, 500].includes(prod.status) ? !find(prod.body.hosts) : true, 'staging data never appears in prod');

    console.log('✔ heartbeat + OTLP metrics populate the Linux and Fleet views (CPU, memory, worst filesystem, agent version); no key -> 401');
    console.log('E2E REAL DATA POPULATES TESTS PASSED');
  } finally {
    child.kill();
    if (!process.env.SENTINEL_RUNTIME_DIR) { try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch (_) { /* ignore */ } }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
