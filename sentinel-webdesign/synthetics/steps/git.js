/**
 * synthetics/steps/git.js
 *
 * Git probe step: ls-remote or shallow clone of a canary repo into a temp directory with cleanup.
 *
 * [Phase S / S9]
 *  - git runs through async execFile (no shell, never execSync/spawnSync), so a slow remote never
 *    blocks the event loop.
 *  - The credential (context.credential, resolved by the runner from CyberArk via the journey's
 *    credentials_purpose, or step.credentials_purpose resolved here) is passed to git as an
 *    `http.extraHeader` through GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0, so it never
 *    appears in argv. It is never logged and is redacted from any error text returned.
 *  - GIT_TERMINAL_PROMPT=0: git fails instead of waiting on a prompt.
 *  - SENTINEL_GIT_BIN overrides the git executable (tests only).
 *
 * [Phase Q / Q1] action: push_reset — clone the canary repo (shallow), commit on a dedicated canary
 *  branch, push it, then put the branch back exactly as it was (force-with-lease back to the previous
 *  commit, or delete the branch if it did not exist). Emits journey.git.{clone,commit,push,reset}_ms.
 *  The reset is attempted whenever a push was attempted, even if the push itself reported failure
 *  (it may have landed before a timeout killed git). Commit identity comes from GIT_AUTHOR_* /
 *  GIT_COMMITTER_* env, never from git config. The temp dir is always removed.
 */

const { performance } = require('perf_hooks');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_ERROR_CHARS = 500;

// git executable.
function gitBinary() {
  return process.env.SENTINEL_GIT_BIN || 'git';
}

/** Header value for the credential: Basic when the step names a username, Bearer otherwise. */
function authHeaderValue(step, credential) {
  if (step.auth_scheme === 'basic' || step.username) {
    const user = step.username || 'x-token-auth';
    return `Basic ${Buffer.from(`${user}:${credential}`).toString('base64')}`;
  }
  return `Bearer ${credential}`;
}

// Environment for git with credentials.
function buildEnv(step, credential) {
  const env = { ...process.env };
  // Never let an inherited config-env block leak into or collide with ours.
  for (const k of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) delete env[k];
  }
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  env.GIT_ASKPASS = '';
  env.SSH_ASKPASS = '';
  if (credential) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: ${authHeaderValue(step, credential)}`;
  }
  return env;
}

/** Strips the credential (raw, header and base64 forms) and URL userinfo from text. */
function redact(text, secrets) {
  let out = String(text || '');
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  }
  out = out.replace(/(Authorization:\s*(?:Bearer|Basic))\s+\S+/gi, '$1 [REDACTED]');
  out = out.replace(/:\/\/([^/\s:@]+):([^@\s/]+)@/g, '://[REDACTED]@');
  return out;
}

// Runs git.
function runGit(args, { env, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    let file = gitBinary();
    let finalArgs = args;
    if (file && file.endsWith('.js')) {
      finalArgs = [file, ...args];
      file = process.execPath;
    }
    execFile(file, finalArgs, {
      env,
      cwd,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: false
    }, (err, stdout, stderr) => {
      if (err) {
        err.stderrText = String(stderr || '');
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Readable failure text.
function describeFailure(err, action, timeoutMs) {
  if (err.killed && err.signal) {
    return `git ${action} timed out after ${timeoutMs}ms`;
  }
  if (err.code === 'ENOENT') {
    return `git executable not found (${gitBinary()})`;
  }
  const exit = typeof err.code === 'number' ? ` (exit ${err.code})` : '';
  const stderr = (err.stderrText || '').trim().slice(0, MAX_ERROR_CHARS);
  return `git ${action} failed${exit}${stderr ? `: ${stderr}` : ''}`;
}

// Credential for the step.
async function resolveCredential(step, context) {
  if (context.credential) return context.credential;
  if (!step.credentials_purpose || !context.appId) return null;
  let provider = context.credentialProvider || null;
  if (!provider) {
    try {
      provider = require('@sentinel/config/cyberark/credential_provider');
    } catch (_) {
      try { provider = require('../../backend/config/cyberark/credential_provider'); } catch (__) { provider = null; }
    }
  }
  if (!provider || typeof provider.getCredential !== 'function') return null;
  try {
    return await provider.getCredential(context.appId, step.credentials_purpose, { env: context.env });
  } catch (_) {
    return null;
  }
}

// Runs a git step (clone, ls-remote, ...).
async function executeGitStep(step, context = {}) {
  const t0 = performance.now();
  const repoUrl = step.repo_url || step.url || context.repoUrl;
  if (!repoUrl) {
    return {
      success: false,
      status: 'ERROR',
      durationMs: performance.now() - t0,
      error: 'Git step requires repo_url'
    };
  }
  if (typeof repoUrl !== 'string' || repoUrl.startsWith('-')) {
    return {
      success: false,
      status: 'ERROR',
      durationMs: performance.now() - t0,
      error: 'Git step repo_url is invalid'
    };
  }

  const action = step.action || (step.shallow_clone ? 'clone' : 'ls-remote');
  if (action === 'push_reset') {
    return executePushReset(step, context, repoUrl, t0);
  }
  const credential = await resolveCredential(step, context);
  const secrets = credential
    ? [credential, authHeaderValue(step, credential), Buffer.from(String(credential)).toString('base64')]
    : [];
  const env = buildEnv(step, credential);
  let tempDir = null;

  try {
    if (action === 'ls-remote') {
      const timeoutMs = step.timeout_ms || 15000;
      try {
        await runGit(['ls-remote', '--heads', '--', repoUrl], { env, timeoutMs });
      } catch (err) {
        throw new Error(describeFailure(err, action, timeoutMs));
      }
    } else {
      const timeoutMs = step.timeout_ms || 30000;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel_canary_git_${crypto.randomBytes(4).toString('hex')}_`));
      fs.chmodSync(tempDir, 0o700);
      const cloneDir = path.join(tempDir, 'repo');
      try {
        await runGit(['clone', '--depth', '1', '--quiet', '--', repoUrl, cloneDir], { env, timeoutMs });
      } catch (err) {
        throw new Error(describeFailure(err, 'clone', timeoutMs));
      }
    }

    const durationMs = performance.now() - t0;
    if (step.assert?.max_ms && durationMs > step.assert.max_ms) {
      return {
        success: false,
        status: 'ERROR',
        durationMs,
        error: `Git action exceeded max latency: ${durationMs.toFixed(1)}ms > ${step.assert.max_ms}ms`
      };
    }

    return {
      success: true,
      status: 'OK',
      durationMs
    };
  } catch (err) {
    return {
      success: false,
      status: 'ERROR',
      durationMs: performance.now() - t0,
      error: redact(err.message, secrets)
    };
  } finally {
    if (tempDir) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------------------------
// [Q1] push_reset
// ---------------------------------------------------------------------------------------------

const DEFAULT_CANARY_BRANCH = 'sentinel-canary';
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Conservative branch-name check: no option injection, no ref traversal, no refspec syntax. */
function validBranch(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(name)
    && !name.includes('..')
    && !name.includes('//')
    && !name.endsWith('/')
    && !name.endsWith('.lock')
    && !name.endsWith('.');
}

/** Parses `git ls-remote` output for one exact ref; returns the sha or null when absent. */
function parseLsRemote(stdout, ref) {
  for (const line of String(stdout || '').split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && SHA_RE.test(sha || '')) return sha;
  }
  return null;
}

// Pushes to and resets a canary branch.
async function executePushReset(step, context, repoUrl, t0) {
  const branch = step.branch || DEFAULT_CANARY_BRANCH;
  if (!validBranch(branch)) {
    return { success: false, status: 'ERROR', durationMs: performance.now() - t0, error: 'Git push_reset step has an invalid branch name' };
  }
  const ref = `refs/heads/${branch}`;
  const timeoutMs = step.timeout_ms || 30000;
  const credential = await resolveCredential(step, context);
  const secrets = credential
    ? [credential, authHeaderValue(step, credential), Buffer.from(String(credential)).toString('base64')]
    : [];
  const env = buildEnv(step, credential);
  const author = step.author || {};
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = author.name || 'SENTINEL Synthetics';
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = author.email || 'sentinel-synthetics@invalid';

  const timings = { clone_ms: null, commit_ms: null, push_ms: null, reset_ms: null };
  const attributes = { 'git.branch': branch, 'git.reset': 'not_attempted' };
  let tempDir = null;
  let phase = 'clone';
  let error = null;
  let pushAttempted = false;
  let pushOk = false;
  let prevSha = null;
  let newSha = null;
  let cloneDir = null;

  const git = (args, cwd) => runGit(args, { env, timeoutMs, cwd });
  // runGit rejections carry stderrText; anything else is a local error.
  const fail = (err, what) => new Error(err && typeof err.stderrText === 'string'
    ? describeFailure(err, what, timeoutMs) : String((err && err.message) || err));

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel_canary_git_${crypto.randomBytes(4).toString('hex')}_`));
    fs.chmodSync(tempDir, 0o700);
    cloneDir = path.join(tempDir, 'repo');

    // 1. clone (includes discovering whether the canary branch already exists)
    let ts = performance.now();
    let lsOut;
    try {
      lsOut = await git(['ls-remote', '--heads', '--', repoUrl, ref]);
    } catch (err) { throw fail(err, 'ls-remote'); }
    const branchExisted = parseLsRemote(lsOut.stdout, ref) !== null;
    const cloneArgs = ['clone', '--depth', '1', '--no-tags', '--quiet'];
    if (branchExisted) cloneArgs.push('--single-branch', '--branch', branch);
    cloneArgs.push('--', repoUrl, cloneDir);
    try {
      await git(cloneArgs);
    } catch (err) { throw fail(err, 'clone'); }
    if (branchExisted) {
      // The commit we restore to is the one we actually cloned (and will push on top of).
      try {
        prevSha = (await git(['rev-parse', '--verify', 'HEAD'], cloneDir)).stdout.trim();
      } catch (err) { throw fail(err, 'rev-parse'); }
      if (!SHA_RE.test(prevSha)) throw new Error('git rev-parse returned no commit for the existing canary branch');
    }
    timings.clone_ms = performance.now() - ts;

    // 2. commit
    phase = 'commit';
    ts = performance.now();
    const stamp = `sentinel canary ${new Date().toISOString()} run=${context.traceId || crypto.randomBytes(8).toString('hex')}\n`;
    fs.writeFileSync(path.join(cloneDir, step.canary_file || '.sentinel-canary'), stamp);
    try {
      await git(['add', '--', step.canary_file || '.sentinel-canary'], cloneDir);
      await git(['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', step.commit_message || 'SENTINEL synthetic canary commit (auto-reset)'], cloneDir);
      newSha = (await git(['rev-parse', '--verify', 'HEAD'], cloneDir)).stdout.trim();
    } catch (err) { throw fail(err, 'commit'); }
    timings.commit_ms = performance.now() - ts;

    // 3. push (fast-forward only when the branch existed; creation otherwise)
    phase = 'push';
    ts = performance.now();
    pushAttempted = true;
    try {
      await git(['push', '--quiet', '--no-verify', '--', repoUrl, `HEAD:${ref}`], cloneDir);
    } catch (err) { throw fail(err, 'push'); }
    pushOk = true;
    timings.push_ms = performance.now() - ts;
  } catch (err) {
    error = `${phase} failed: ${err.message}`;
  }

  // 4. reset — attempted whenever a push was attempted.
  if (pushAttempted) {
    const ts = performance.now();
    try {
      let needsReset = pushOk;
      if (!pushOk) {
        // Push reported failure; it may still have landed. Look before touching the branch.
        const out = await git(['ls-remote', '--heads', '--', repoUrl, ref], cloneDir);
        needsReset = parseLsRemote(out.stdout, ref) === newSha;
      }
      if (needsReset) {
        // Lease on our own commit: never clobber a push someone else made in the meantime.
        const lease = `--force-with-lease=${ref}:${newSha}`;
        const target = prevSha ? `${prevSha}:${ref}` : `:${ref}`;
        await git(['push', '--quiet', '--no-verify', lease, '--', repoUrl, target], cloneDir);
        attributes['git.reset'] = prevSha ? 'restored' : 'deleted';
      } else {
        attributes['git.reset'] = 'not_needed';
      }
      timings.reset_ms = performance.now() - ts;
    } catch (err) {
      attributes['git.reset'] = 'failed';
      const msg = `reset failed, canary branch ${branch} may be left at ${newSha}: ${fail(err, 'push (reset)').message}`;
      error = error ? `${error}; ${msg}` : msg;
    }
  }

  if (tempDir) {
    try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (_) {}
  }

  const durationMs = performance.now() - t0;
  const metrics = {};
  for (const [k, v] of Object.entries(timings)) {
    if (typeof v === 'number' && Number.isFinite(v)) metrics[`journey.git.${k}`] = v;
  }
  if (!error && step.assert?.max_ms && durationMs > step.assert.max_ms) {
    error = `Git push_reset exceeded max latency: ${durationMs.toFixed(1)}ms > ${step.assert.max_ms}ms`;
  }
  // Per-run identifiers go in details (span/step record), never metric attributes (cardinality).
  const details = { 'git.previous_sha': prevSha, 'git.canary_sha': newSha };

  return {
    success: !error,
    status: error ? 'ERROR' : 'OK',
    durationMs,
    error: error ? redact(error, secrets) : undefined,
    timings,
    metrics,
    attributes,
    details
  };
}

module.exports = {
  executeGitStep,
  _redact: redact
};
