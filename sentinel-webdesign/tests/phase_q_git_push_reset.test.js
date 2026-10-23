'use strict';

/**
 * tests/phase_q_git_push_reset.test.js
 *
 * Phase Q / Q1 acceptance: git step `action: push_reset` against a local bare repo (file:// URL).
 *  - existing canary branch: commit pushed, then branch force-restored to its previous commit
 *  - absent canary branch: branch created, then deleted
 *  - push that lands but reports failure: reset is still attempted
 *  - clone/commit/push/reset timings are numbers, temp clone dir removed
 *  - credential only in GIT_CONFIG_VALUE_0, never in argv; commit identity via env, not git config
 *  - runner emits journey.git.*_ms metrics for the step
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel_phase_q_git_'));
const credential = `cyberark-canary-secret-${Date.now().toString(36)}`;
let REAL_GIT = 'git';
try {
  REAL_GIT = execFileSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? ['git.exe'] : ['-c', 'command -v git']).toString().trim().split(/\r?\n/)[0];
} catch (_) {
  REAL_GIT = 'git';
}

function sh(args, cwd) {
  return execFileSync(REAL_GIT, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'
    }
  }).toString().trim();
}

function remoteSha(bare, branch) {
  try { return sh(['rev-parse', '--verify', `refs/heads/${branch}`], bare); } catch (_) { return null; }
}

/** Wrapper around the real git that records argv + GIT_* env, optionally failing pushes after they land. */
function writeWrapper(dumpFile) {
  const bin = path.join(scratch, 'git-wrapper.js');
  fs.writeFileSync(bin, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const { spawnSync } = require('child_process');",
    'const env = {};',
    'for (const k of Object.keys(process.env)) if (/^GIT_/.test(k)) env[k] = process.env[k];',
    'const argv = process.argv.slice(2);',
    'fs.appendFileSync(process.env.WRAP_DUMP, JSON.stringify({ argv, env }) + "\\n");',
    `const r = spawnSync(${JSON.stringify(REAL_GIT)}, argv, { stdio: 'inherit' });`,
    'const isCanaryPush = argv[0] === "push" && !argv.some(a => a.startsWith("--force-with-lease"));',
    'if (isCanaryPush && process.env.WRAP_FAIL_PUSH_AFTER === "1") { process.stderr.write("fatal: simulated timeout after push landed\\n"); process.exit(128); }',
    'process.exit(r.status === null ? 1 : r.status);',
    ''
  ].join('\n'), { mode: 0o755 });
  process.env.SENTINEL_GIT_BIN = bin;
  process.env.WRAP_DUMP = dumpFile;
}

function readDump(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function tempDirsFromDump(calls) {
  const dirs = new Set();
  for (const c of calls) {
    if (c.argv[0] === 'clone') dirs.add(path.dirname(c.argv[c.argv.length - 1]));
  }
  return [...dirs];
}

function assertTimings(res, { reset = true } = {}) {
  for (const k of ['clone_ms', 'commit_ms', 'push_ms']) {
    assert.strictEqual(typeof res.timings[k], 'number', `${k} must be a number`);
    assert(Number.isFinite(res.timings[k]) && res.timings[k] >= 0);
    assert.strictEqual(res.metrics[`journey.git.${k}`], res.timings[k]);
  }
  if (reset) {
    assert.strictEqual(typeof res.timings.reset_ms, 'number');
    assert.strictEqual(res.metrics['journey.git.reset_ms'], res.timings.reset_ms);
  }
}

function assertCredentialHandling(calls) {
  assert(calls.length > 0, 'git must have been invoked');
  for (const c of calls) {
    const argvText = JSON.stringify(c.argv);
    assert(!argvText.includes(credential), `credential in argv: ${argvText}`);
    assert(!argvText.includes(Buffer.from(credential).toString('base64')), 'encoded credential in argv');
    assert(!argvText.includes('extraHeader'), 'header config must not be in argv');
    assert(!c.argv.includes('-c'), 'no -c config overrides in argv');
    assert.strictEqual(c.env.GIT_CONFIG_KEY_0, 'http.extraHeader');
    assert.strictEqual(c.env.GIT_CONFIG_VALUE_0, `Authorization: Bearer ${credential}`);
    assert.strictEqual(c.env.GIT_TERMINAL_PROMPT, '0');
  }
  const commit = calls.find(c => c.argv[0] === 'commit');
  assert(commit, 'a commit must have been made');
  assert.strictEqual(commit.env.GIT_AUTHOR_NAME, 'SENTINEL Synthetics');
  assert.strictEqual(commit.env.GIT_COMMITTER_EMAIL, 'sentinel-synthetics@invalid');
}

async function main() {
  const { executeGitStep } = require('../synthetics/steps/git');

  // Seed a bare repo with one commit on main.
  const bare = path.join(scratch, 'canary.git');
  sh(['init', '--bare', '--quiet', '--initial-branch=main', bare]);
  const seed = path.join(scratch, 'seed');
  sh(['init', '--quiet', '--initial-branch=main', seed]);
  fs.writeFileSync(path.join(seed, 'README'), 'canary\n');
  sh(['add', 'README'], seed);
  sh(['commit', '--quiet', '--no-gpg-sign', '-m', 'seed'], seed);
  sh(['push', '--quiet', bare, 'main:refs/heads/main'], seed);
  const repoUrl = `file://${bare}`;
  const mainSha = remoteSha(bare, 'main');

  const dumpFile = path.join(scratch, 'dump.jsonl');
  writeWrapper(dumpFile);
  const ctx = { credential, appId: 'bitbucket', env: 'staging', traceId: 'abc123' };

  // 1. Branch absent → created, then deleted.
  console.log('[Q1] push_reset with no existing canary branch');
  fs.writeFileSync(dumpFile, '');
  assert.strictEqual(remoteSha(bare, 'sentinel-canary'), null);
  let res = await executeGitStep({ id: 'pr', action: 'push_reset', repo_url: repoUrl }, ctx);
  assert.strictEqual(res.success, true, `push_reset should succeed: ${res.error}`);
  assert.strictEqual(res.status, 'OK');
  assert.strictEqual(res.attributes['git.reset'], 'deleted');
  assert.strictEqual(remoteSha(bare, 'sentinel-canary'), null, 'canary branch must be deleted again');
  assert.strictEqual(remoteSha(bare, 'main'), mainSha, 'main untouched');
  let calls = readDump(dumpFile);
  const canaryPush = calls.find(c => c.argv[0] === 'push' && c.argv.includes('HEAD:refs/heads/sentinel-canary'));
  assert(canaryPush, 'canary commit was pushed');
  const canarySha = res.details['git.canary_sha'];
  assert(/^[0-9a-f]{40}$/.test(canarySha));
  assert.strictEqual(sh(['cat-file', '-t', canarySha], bare), 'commit', 'pushed commit reached the remote');
  assert.strictEqual(sh(['log', '-1', '--format=%an', canarySha], bare), 'SENTINEL Synthetics');
  assertTimings(res);
  assertCredentialHandling(calls);
  for (const d of tempDirsFromDump(calls)) assert(!fs.existsSync(d), `temp dir ${d} must be removed`);
  console.log(`  -> PASSED: branch created then deleted; timings clone=${res.timings.clone_ms.toFixed(0)} commit=${res.timings.commit_ms.toFixed(0)} push=${res.timings.push_ms.toFixed(0)} reset=${res.timings.reset_ms.toFixed(0)}ms`);

  // 2. Branch exists → pushed on top, then restored to the previous commit.
  console.log('[Q1] push_reset with an existing canary branch');
  sh(['push', '--quiet', bare, 'main:refs/heads/canary-x'], seed);
  const before = remoteSha(bare, 'canary-x');
  fs.writeFileSync(dumpFile, '');
  res = await executeGitStep({ id: 'pr', action: 'push_reset', repo_url: repoUrl, branch: 'canary-x' }, ctx);
  assert.strictEqual(res.success, true, `push_reset should succeed: ${res.error}`);
  assert.strictEqual(res.attributes['git.reset'], 'restored');
  assert.strictEqual(res.details['git.previous_sha'], before);
  assert.notStrictEqual(res.details['git.canary_sha'], before);
  assert.strictEqual(sh(['rev-parse', `${res.details['git.canary_sha']}^`], bare), before, 'canary commit was on top of the branch');
  assert.strictEqual(remoteSha(bare, 'canary-x'), before, 'branch restored to its previous commit');
  calls = readDump(dumpFile);
  assert(calls.some(c => c.argv[0] === 'push' && c.argv.includes(`${before}:refs/heads/canary-x`)), 'reset force-pushed previous commit');
  assertTimings(res);
  assertCredentialHandling(calls);
  for (const d of tempDirsFromDump(calls)) assert(!fs.existsSync(d), `temp dir ${d} must be removed`);
  console.log('  -> PASSED: branch restored to previous commit with force-with-lease');

  // 3. Push lands but git reports failure → reset still happens, step fails honestly.
  console.log('[Q1] push lands but reports failure');
  process.env.WRAP_FAIL_PUSH_AFTER = '1';
  fs.writeFileSync(dumpFile, '');
  res = await executeGitStep({ id: 'pr', action: 'push_reset', repo_url: repoUrl, branch: 'canary-x' }, ctx);
  delete process.env.WRAP_FAIL_PUSH_AFTER;
  assert.strictEqual(res.success, false);
  assert(/push failed/.test(res.error), res.error);
  assert(!res.error.includes(credential));
  assert.strictEqual(res.timings.push_ms, null, 'failed push has no timing');
  assert(!('journey.git.push_ms' in res.metrics), 'no push metric emitted for a failed push');
  assert.strictEqual(res.attributes['git.reset'], 'restored', 'reset attempted after a landed push');
  assert.strictEqual(typeof res.timings.reset_ms, 'number');
  assert.strictEqual(remoteSha(bare, 'canary-x'), before, 'branch restored after failed-but-landed push');
  for (const d of tempDirsFromDump(readDump(dumpFile))) assert(!fs.existsSync(d));
  console.log('  -> PASSED: reset ran although the push reported failure');

  // 4. Clone failure: no push attempted, no reset, temp dir cleaned, step failed.
  console.log('[Q1] unreachable repo');
  fs.writeFileSync(dumpFile, '');
  res = await executeGitStep({ id: 'pr', action: 'push_reset', repo_url: `file://${path.join(scratch, 'missing.git')}` }, ctx);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.attributes['git.reset'], 'not_attempted');
  assert.strictEqual(res.timings.clone_ms, null);
  assert.deepStrictEqual(res.metrics, {});
  assert(!readDump(dumpFile).some(c => c.argv[0] === 'push'));
  console.log('  -> PASSED: clone failure reported, nothing pushed, no fabricated timings');

  // 5. Invalid branch name refused before git runs.
  fs.writeFileSync(dumpFile, '');
  res = await executeGitStep({ action: 'push_reset', repo_url: repoUrl, branch: '--force' }, ctx);
  assert.strictEqual(res.success, false);
  assert.strictEqual(readDump(dumpFile).length, 0);
  res = await executeGitStep({ action: 'push_reset', repo_url: repoUrl, branch: 'a/../b' }, ctx);
  assert.strictEqual(res.success, false);
  console.log('  -> PASSED: invalid branch names rejected');

  // 6. Runner emits the step's journey.git.* metrics.
  console.log('[Q1] runner emits journey.git.* metrics');
  const { JourneyRunner } = require('../synthetics/runner');
  const metrics = [];
  const spans = [];
  const runner = new JourneyRunner({
    isLeaderCheck: () => true,
    clickhouseClient: { insertSpans: async s => { spans.push(...s); } },
    dbManager: { addMetricBatch: m => metrics.push(...m) },
    credentialProvider: { getCredential: async () => credential }
  });
  const run = await runner.runJourney('bitbucket', {
    id: 'bb_canary', credentials_purpose: 'api_token',
    steps: [{ id: 'git_push_reset', type: 'git', layer: 'storage', action: 'push_reset', repo_url: repoUrl }]
  }, 'staging');
  assert.strictEqual(run.success, true, run.failingError);
  for (const k of ['clone_ms', 'commit_ms', 'push_ms', 'reset_ms']) {
    const m = metrics.find(x => x.metricName === `journey.git.${k}`);
    assert(m, `journey.git.${k} emitted`);
    assert.strictEqual(typeof m.value, 'number');
    assert.strictEqual(m.attributes.step, 'git_push_reset');
    assert.strictEqual(m.attributes['git.reset'], 'deleted');
    assert(!('git.canary_sha' in m.attributes), 'per-run sha must not be a metric attribute');
  }
  const stepSpan = spans.find(s => (s.name || '').includes('git_push_reset') || JSON.stringify(s).includes('git_push_reset'));
  assert(stepSpan, 'step span recorded');
  assert.strictEqual(remoteSha(bare, 'sentinel-canary'), null);
  console.log('  -> PASSED: runner emitted journey.git.{clone,commit,push,reset}_ms');

  delete process.env.SENTINEL_GIT_BIN;
  console.log('\nphase_q_git_push_reset: ALL PASSED');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {} setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); });
