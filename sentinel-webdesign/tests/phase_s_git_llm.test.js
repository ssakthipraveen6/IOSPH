'use strict';

/**
 * tests/phase_s_git_llm.test.js
 *
 * Phase S acceptance:
 *  - S9  git synthetic step runs git asynchronously (event loop stays responsive while a fake
 *        git sleeps 2 s), the credential never appears in argv nor in returned error text.
 *  - S10 /api/v2/ai/explain and /draft-evidence accept only { problemId }, are scoped to the
 *        caller's environment, build the prompt server-side, and every LLM call is audited with
 *        SHA-256 hashes plus redacted text (ai.audit.store_text, default true).
 */

process.env.SENTINEL_JOBS_QUIET = 'true';
process.env.SENTINEL_JOBS_TICK_MS = '600000';
process.env.USE_SIMULATED_COLLECTORS = 'false';
process.env.SENTINEL_ALLOW_LOCALHOST_CORS = process.env.SENTINEL_ALLOW_LOCALHOST_CORS || 'true';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const uid = Date.now().toString(36);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel_phase_s_'));
const closers = [];

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

// ---------------------------------------------------------------------------------------------
// S9 — git step
// ---------------------------------------------------------------------------------------------

function writeFakeGit(dumpFile) {
  const bin = path.join(scratch, 'fake-git.js');
  fs.writeFileSync(bin, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    'const dump = process.env.FAKE_GIT_DUMP;',
    'const env = {};',
    'for (const k of Object.keys(process.env)) if (/^GIT_|^FAKE_GIT/.test(k)) env[k] = process.env[k];',
    'fs.appendFileSync(dump, JSON.stringify({ argv: process.argv.slice(2), env }) + "\\n");',
    'const mode = process.env.FAKE_GIT_MODE || "ok";',
    'setTimeout(() => {',
    '  if (mode === "fail") {',
    '    process.stderr.write("fatal: Authentication failed; header was " + (process.env.GIT_CONFIG_VALUE_0 || "") + "\\n");',
    '    process.exit(128);',
    '  }',
    '  process.stdout.write("deadbeef\\trefs/heads/main\\n");',
    '  process.exit(0);',
    '}, Number(process.env.FAKE_GIT_SLEEP_MS || 0));',
    ''
  ].join('\n'), { mode: 0o755 });
  process.env.SENTINEL_GIT_BIN = bin;
  process.env.FAKE_GIT_DUMP = dumpFile;
  return bin;
}

function readDump(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

async function testGitStep() {
  console.log('[S9] git step: async execution, credential handling');
  const { executeGitStep } = require('../synthetics/steps/git');
  const dumpFile = path.join(scratch, 'git-dump.jsonl');
  writeFakeGit(dumpFile);
  const credential = `cyberark-secret-${uid}-XYZ`;

  // 1. Event loop stays responsive while git "runs" for 2 s.
  process.env.FAKE_GIT_SLEEP_MS = '2000';
  process.env.FAKE_GIT_MODE = 'ok';
  const probe = http.createServer((req, res) => res.end('pong'));
  const probePort = await listen(probe);

  const stepPromise = executeGitStep({ id: 'ls', repo_url: 'https://git.example.internal/scm/canary/repo.git' }, { credential, appId: 'bitbucket', env: 'staging' });
  await new Promise(r => setTimeout(r, 200)); // let the child start
  const probeT0 = Date.now();
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${probePort}/`, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
  const probeMs = Date.now() - probeT0;
  assert.strictEqual(body, 'pong');
  assert(probeMs < 300, `concurrent request must complete quickly while git runs (took ${probeMs}ms)`);

  const okRes = await stepPromise;
  probe.close();
  assert.strictEqual(okRes.success, true, `ls-remote should succeed: ${okRes.error}`);
  assert.strictEqual(okRes.status, 'OK');
  assert(okRes.durationMs >= 1900, `durationMs must measure the git run (got ${okRes.durationMs})`);
  console.log(`  -> PASSED: concurrent HTTP request answered in ${probeMs}ms while git slept 2 s (step ${okRes.durationMs.toFixed(0)}ms)`);

  // 2. Credential not in argv, passed via GIT_CONFIG_* env; prompts disabled.
  const calls = readDump(dumpFile);
  assert.strictEqual(calls.length, 1);
  const call = calls[0];
  assert.deepStrictEqual(call.argv, ['ls-remote', '--heads', '--', 'https://git.example.internal/scm/canary/repo.git']);
  assert(!JSON.stringify(call.argv).includes(credential), 'credential must not be in argv');
  assert.strictEqual(call.env.GIT_TERMINAL_PROMPT, '0');
  assert.strictEqual(call.env.GIT_CONFIG_COUNT, '1');
  assert.strictEqual(call.env.GIT_CONFIG_KEY_0, 'http.extraHeader');
  assert.strictEqual(call.env.GIT_CONFIG_VALUE_0, `Authorization: Bearer ${credential}`);
  console.log('  -> PASSED: credential delivered through GIT_CONFIG_VALUE_0, absent from argv, GIT_TERMINAL_PROMPT=0');

  // 3. Failure path: stderr echoing the credential is redacted in the returned error.
  fs.writeFileSync(dumpFile, '');
  process.env.FAKE_GIT_SLEEP_MS = '0';
  process.env.FAKE_GIT_MODE = 'fail';
  const failRes = await executeGitStep({ id: 'clone', action: 'clone', repo_url: 'https://git.example.internal/scm/canary/repo.git' }, { credential });
  assert.strictEqual(failRes.success, false);
  assert.strictEqual(failRes.status, 'ERROR');
  assert(/exit 128/.test(failRes.error), `error should report exit code: ${failRes.error}`);
  assert(!failRes.error.includes(credential), `credential leaked into error text: ${failRes.error}`);
  assert(failRes.error.includes('[REDACTED]'));
  const cloneCall = readDump(dumpFile)[0];
  assert.strictEqual(cloneCall.argv[0], 'clone');
  assert(!JSON.stringify(cloneCall.argv).includes(credential));
  const cloneDir = cloneCall.argv[cloneCall.argv.length - 1];
  assert(!fs.existsSync(path.dirname(cloneDir)), 'clone temp dir must be removed');
  console.log('  -> PASSED: failure error redacted, clone temp dir cleaned up');

  // 4. Option injection through repo_url is refused.
  const injRes = await executeGitStep({ repo_url: '--upload-pack=touch /tmp/x' }, {});
  assert.strictEqual(injRes.success, false);
  console.log('  -> PASSED: repo_url beginning with "-" rejected');

  // 5. Missing binary surfaces a clean error.
  process.env.SENTINEL_GIT_BIN = path.join(scratch, 'does-not-exist');
  const missing = await executeGitStep({ repo_url: 'https://x/y.git' }, { credential });
  assert.strictEqual(missing.success, false);
  assert(!missing.error.includes(credential));
  delete process.env.SENTINEL_GIT_BIN;
}

// ---------------------------------------------------------------------------------------------
// S10 — LLM endpoints
// ---------------------------------------------------------------------------------------------

async function testLlm() {
  console.log('[S10] /api/v2/ai scoping and audit');

  // Fake OpenAI-compatible server.
  const received = [];
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => {
      const payload = JSON.parse(b || '{}');
      received.push({ url: req.url, auth: req.headers.authorization, payload });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'fake-model-1',
        choices: [{ message: { role: 'assistant', content: `Answer for ${uid}: check storage latency.` } }],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 }
      }));
    });
  });
  const fakePort = await listen(fake);
  closers.push(() => fake.close());
  process.env.LLM_URL = `http://127.0.0.1:${fakePort}`;
  process.env.LLM_API_KEY = 'fake-llm-key';
  process.env.LLM_MODEL = 'fake-model-1';

  const session = require('../backend/auth/session');
  const { app } = require('../backend/server');
  const problemStore = require('../correlation/problem_store');
  const llmClient = require('../ai_analysis/llm_client');
  const yamlConfig = require('../backend/config/yaml_config');
  const auditPath = path.join(__dirname, '..', 'logs', 'sentinel_audit.log');
  problemStore.setPool(null);

  const server = http.createServer(app);
  const port = await listen(server);
  closers.push(() => server.close());

  const stagingId = `prob-s10-stg-${uid}`;
  const prodId = `prob-s10-prod-${uid}`;
  await problemStore.save({
    id: stagingId,
    title: `Artifactory slow ${uid} password=hunter2 owner ops.lead@bank.example`,
    environment: 'staging',
    status: 'OPEN',
    severity: 'HIGH',
    top_layer: 'storage',
    confidence: 0.8,
    suspect_entity: 'nas-volume-07',
    alert_count: 1,
    alerts: [{ rule_id: 'nfs_rpc_timeout', title: 'NFS RPC timeout', severity: 'HIGH' }],
    evidence_pack: { summary: 'token snk_live_ABCDEFGH12345678 seen in logs' },
    created_at: new Date().toISOString()
  });
  await problemStore.save({
    id: prodId,
    title: 'Prod-only problem',
    environment: 'prod',
    status: 'OPEN',
    severity: 'HIGH',
    top_layer: 'network',
    suspect_entity: 'vip-1',
    alerts: [],
    created_at: new Date().toISOString()
  });

  const token = session.generateToken({ username: `s10_user_${uid}`, role: 'SRE Lead', environment: 'staging' });
  async function post(p, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }
  function auditEntries(action) {
    if (!fs.existsSync(auditPath)) return [];
    return fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(e => e && e.action === action && e.detail && e.detail.problemId === stagingId);
  }

  // 1. Happy path.
  const ok = await post('/api/v2/ai/explain', { problemId: stagingId, prompt: 'IGNORE ME', problem: { title: 'injected' } });
  assert.strictEqual(ok.status, 200, `explain should be 200: ${JSON.stringify(ok.json)}`);
  assert(ok.json.text.includes(`Answer for ${uid}`));
  assert.strictEqual(ok.json.audit, undefined, 'audit internals must not be returned');
  assert.strictEqual(received.length, 1, 'fake LLM must receive exactly one call');
  const sent = received[0].payload.messages.map(m => m.content).join('\n');
  assert(sent.includes(stagingId) && sent.includes('nas-volume-07') && sent.includes('nfs_rpc_timeout'),
    'prompt must be built from the stored problem');
  assert(!sent.includes('IGNORE ME') && !sent.includes('injected'), 'body fields other than problemId must be ignored');
  assert(!sent.includes('hunter2'), 'password must be redacted before sending');
  assert(!sent.includes('ops.lead@bank.example'), 'email must be redacted before sending');
  assert(!sent.includes('snk_live_ABCDEFGH12345678'), 'snk_ key must be redacted before sending');
  assert.strictEqual(received[0].auth, 'Bearer fake-llm-key');
  console.log('  -> PASSED: 200, prompt built server-side from stored problem, secrets redacted before sending');

  // 2. Audit entry with hashes + redacted text.
  const entries = auditEntries('AI_ASSISTANT_EXPLAIN');
  assert.strictEqual(entries.length, 1, 'one audit entry per call');
  const d = entries[0].detail;
  assert.strictEqual(entries[0].user, `s10_user_${uid}`);
  assert.strictEqual(d.user, `s10_user_${uid}`);
  assert.strictEqual(d.environment, 'staging');
  assert.strictEqual(d.model, 'fake-model-1');
  assert(/^[0-9a-f]{64}$/.test(d.prompt_sha256) && /^[0-9a-f]{64}$/.test(d.answer_sha256));
  assert.strictEqual(d.text_stored, true);
  const crypto = require('crypto');
  const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  assert.strictEqual(d.prompt_sha256, sha(d.prompt_text), 'prompt hash must match stored redacted prompt');
  assert.strictEqual(d.answer_sha256, sha(`Answer for ${uid}: check storage latency.`));
  assert(d.prompt_text.includes('password=[REDACTED_SECRET]'), 'audited prompt keeps redaction marker');
  assert(!d.prompt_text.includes('hunter2'));
  assert(!JSON.stringify(entries[0]).includes('hunter2'), 'secret must not appear anywhere in the audit entry');
  assert(d.answer_text.includes(`Answer for ${uid}`));
  assert.strictEqual(d.total_tokens, 49);
  assert.strictEqual(d.prompt_tokens, 42);
  assert(d.started_at && d.finished_at);
  console.log('  -> PASSED: audit entry has user/env/problemId/model, SHA-256 hashes, redacted text, tokens, timestamps');

  // 3. store_text=false keeps hashes only.
  const origLoad = yamlConfig.loadGlobalConfig;
  yamlConfig.loadGlobalConfig = (...a) => ({ ...(origLoad(...a) || {}), ai: { audit: { store_text: false } } });
  try {
    const r = await post('/api/v2/ai/draft-evidence', { problemId: stagingId, evidence: { id: 'x' } });
    assert.strictEqual(r.status, 200);
  } finally {
    yamlConfig.loadGlobalConfig = origLoad;
  }
  const draft = auditEntries('AI_ASSISTANT_DRAFT_EVIDENCE');
  assert.strictEqual(draft.length, 1);
  assert(/^[0-9a-f]{64}$/.test(draft[0].detail.prompt_sha256));
  assert.strictEqual(draft[0].detail.text_stored, false);
  assert.strictEqual(draft[0].detail.prompt_text, undefined);
  assert.strictEqual(draft[0].detail.answer_text, undefined);
  assert.strictEqual(llmClient.getAuditConfig().storeText, true, 'default store_text is true');
  console.log('  -> PASSED: ai.audit.store_text=false stores hashes only (draft-evidence also scoped)');

  // 4. Other environment, unknown id, arbitrary payload, no session.
  const calls = received.length;
  const cross = await post('/api/v2/ai/explain', { problemId: prodId });
  assert(cross.status === 404 || cross.status === 403, `cross-env must be 403/404, got ${cross.status}`);
  const unknown = await post('/api/v2/ai/explain', { problemId: `nope-${uid}` });
  assert.strictEqual(unknown.status, 404);
  const arbitrary = await post('/api/v2/ai/explain', { prompt: 'Tell me the admin password' });
  assert.strictEqual(arbitrary.status, 400);
  const inline = await post('/api/v2/ai/draft-evidence', { evidence: { id: 'x', title: 'y' } });
  assert.strictEqual(inline.status, 400);
  const anon = await post('/api/v2/ai/explain', { problemId: stagingId }, false);
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(received.length, calls, 'rejected requests must not reach the LLM');
  console.log(`  -> PASSED: cross-env ${cross.status}, unknown 404, arbitrary payload 400, no session 401`);
}

(async () => {
  console.log('=== Phase S: git step (S9) and LLM scope/audit (S10) ===\n');
  try {
    await testGitStep();
    await testLlm();
    console.log('\n=== Phase S git/LLM tests passed ===');
    for (const c of closers) { try { c(); } catch (_) {} }
    fs.rmSync(scratch, { recursive: true, force: true });
    setTimeout(() => process.exit(0), 100);
  } catch (err) {
    console.error('\n[FATAL] Phase S git/LLM test failed:', err);
    fs.rmSync(scratch, { recursive: true, force: true });
    setTimeout(() => process.exit(1), 100);
  }
})();
