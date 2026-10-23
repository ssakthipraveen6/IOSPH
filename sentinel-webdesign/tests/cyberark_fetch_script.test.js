'use strict';
// scripts/cyberark_fetch.py: real CCP call when configured, no fake secret in production.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'cyberark_fetch.py');
const PY = process.platform === 'win32' ? 'python' : 'python3';
const run = (args, env) => new Promise((resolve) => {
  const p = spawn(PY, [SCRIPT, ...args], { env: { ...process.env, CYBERARK_CCP_URL: '', CYBERARK_APP_ID: '', NODE_ENV: '', ...env } });
  let out = ''; let err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('close', code => resolve({ code, out, err }));
});

(async () => {
  if (spawnSync(PY, ['--version']).status !== 0) { console.log('cyberark_fetch_script: python not available, skipped'); return; }
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = req.url;
    const q = new URL(req.url, 'http://x').searchParams;
    if (q.get('Object') === 'MISSING') { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Content: 's3cr3t-value', UserName: 'svc' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ccp = `http://127.0.0.1:${server.address().port}/AIMWebService/api/Accounts`;
  try {
    // Real path
    const ok = await run(['--safe', 'SF-X', '--object', 'OBJ-1'], { CYBERARK_CCP_URL: ccp, CYBERARK_APP_ID: 'SENTINEL' });
    assert.strictEqual(ok.code, 0, ok.err);
    assert.strictEqual(JSON.parse(ok.out).value, 's3cr3t-value');
    assert.ok(/AppID=SENTINEL/.test(seen) && /Safe=SF-X/.test(seen) && /Object=OBJ-1/.test(seen), `CCP query carries AppID, Safe, Object (${seen})`);
    const missing = await run(['--safe', 'SF-X', '--object', 'MISSING'], { CYBERARK_CCP_URL: ccp, CYBERARK_APP_ID: 'SENTINEL' });
    assert.strictEqual(missing.code, 1);
    assert.ok(/HTTP 404/.test(missing.err) && !/s3cr3t/.test(missing.err + missing.out));
    const noApp = await run(['--safe', 'SF-X', '--object', 'OBJ-1'], { CYBERARK_CCP_URL: ccp });
    assert.strictEqual(noApp.code, 1);
    // Development fake still works, production refuses it
    const dev = await run(['--safe', 'SF-X', '--object', 'OBJ-1'], {});
    assert.strictEqual(dev.code, 0);
    assert.ok(JSON.parse(dev.out).value.startsWith('CYBERARK_SECRET_'));
    const prod = await run(['--safe', 'SF-X', '--object', 'OBJ-1'], { NODE_ENV: 'production' });
    assert.strictEqual(prod.code, 2, 'production without a CCP URL must not return a fake credential');
    assert.ok(!prod.out.includes('CYBERARK_SECRET_'));
    console.log('cyberark_fetch_script: all assertions passed');
  } finally { server.close(); }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
