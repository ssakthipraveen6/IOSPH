# Agent work order: Sentinel security fixes

You are an engineering agent. Implement the code fixes below in the Sentinel repository, with a regression test for each, and report back. This file is self-contained: you do not need the audit conversation. Background is in `docs/SECURITY_FIX_PLAN.md` (task IDs SF-nn) and the audit `REPORT.md` / `NEEDS-VALIDATION.md` if the owner gives them to you.

## 0. Before you start

**Repository:** `C:\Users\sspra\OneDrive\Desktop\iosph2\sentinel-webdesign` (Windows, inside OneDrive). Node.js backend (`backend/`), React front end (`frontend/`), npm workspaces.

**The folder is not a git repository.** Before any change:

```
cd C:\Users\sspra\OneDrive\Desktop\iosph2\sentinel-webdesign
git init
git add -A
git commit -m "Baseline before security fixes"
git checkout -b security-fixes-2026-11
```

`.gitignore` already excludes `.env`, `.runtime/`, `logs/`, `node_modules/` and `*.zip`. Check `git status` shows none of them before the first commit. Never commit `.env`.

**Toolchain:** Node.js 24 (the owner is upgrading to 24.22.1, see SF-01). Check with `node -v`.

**Commands you will use:**

| Purpose | Command |
|---|---|
| All tests | `npm test` (runs every file in `package.json` `test:all`) |
| One test file | `node tests/<file>.test.js` |
| Lints that must stay clean | `npm run lint:constants`, `npm run lint:random`, `npm run lint:samples`, `npm run lint:demo`, `npm run lint:unreferenced` |
| Config check | `npm run config:check` |
| Front-end build (only if you change `frontend/`) | `npm run build` |

Record the baseline first: run `npm test` and the lints and note which pass. `tests/ui_smoke.test.js` fails when Chromium is missing; that is a known baseline failure, not yours.

## 1. Rules

1. **Change only what a task says.** No refactors, renames or formatting changes outside the lines you fix.
2. **Keep line endings.** Many files are CRLF. Do not convert them.
3. **Comment style.** Every code file starts with a short header comment and every function has a one-line `//` comment above it. Keep that style for anything you add.
4. **Never invent data.** Production code must not contain `Math.random()` or sample values (`lint:random`, `lint:samples`). Demo data lives only under `backend/demo/` and `frontend/src/components/demo/` (`lint:demo`).
5. **No live systems.** Do not call real LDAP, Jenkins, CyberArk, Dynatrace, Bitbucket or the production Sentinel. Tests use stubs, dummy users and `127.0.0.1`.
6. **One commit per task**, message `SF-nn: <title>`, containing the fix and its test. Add each new test file to `test:all` in `package.json`.
7. **Run the full suite after every task.** If something that passed at baseline now fails, fix it before moving on.
8. **Stop and report** instead of guessing if a task needs a decision not written here (see section 4).

## 2. Tasks, in order

Line numbers are correct as of 4 Nov 2026. If a line moved, search for the quoted code.

### SF-06 Refuse to start in an unsafe mode

**Why:** every production control (real LDAP, required login for reads, enforced ingest keys, Secure cookie) switches on only when `NODE_ENV=production`. Without it, anyone can log in as `admin_sentinel` with any password and get Super Admin.

**Change 1, `backend/server.js` line 2357:** the default bind address becomes loopback.

```js
const HOST = process.env.HOST || '127.0.0.1';
```

`web.config` already sets `HOST=0.0.0.0` for IIS, so IIS is unaffected.

**Change 2, `backend/server.js`:** inside `if (require.main === module) { (async () => {`, before the YAML validation, add the guard. Put the check in an exported function so it can be tested:

```js
// Refuses to listen on a network address unless running in production mode or explicitly in dev mode.
function assertSafeStartup(env = process.env, host = HOST) {
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (!loopback && env.NODE_ENV !== 'production' && env.SENTINEL_DEV !== 'true') {
    return `Refusing to listen on ${host}: set NODE_ENV=production (or SENTINEL_DEV=true for development).`;
  }
  return null;
}
```

Call it first: if it returns a message, `console.error('[FATAL] ' + msg); process.exit(1);`. Add `assertSafeStartup` to `module.exports`.

**Change 3, `scripts/bootstrap.js`, `ensureSecret()` (line 58):** before generating a dev secret, read `config/global.yaml` with `js-yaml`. If `environment` is `production`, print the same refusal text as the existing `IS_PROD` branch and `process.exit(1)`.

**Change 4, `backend/auth/ldap_client.js` line 221:** keep the opt-in, but ignore it when the loaded global config says `environment: production`. Log a security warning when it is ignored. The shipped config says `staging`, so `tests/prod_login_lockdown.test.js` still passes. Do not edit that test.

**Test:** new file `tests/startup_guard.test.js`. Assert that `assertSafeStartup` returns:

- an error message for `{}` with host `0.0.0.0`;
- `null` for `{NODE_ENV:'production'}` with `0.0.0.0`;
- `null` for `{}` with `127.0.0.1`;
- `null` for `{SENTINEL_DEV:'true'}` with `0.0.0.0`.

**Done when:** the new test passes, `npm test` passes, and `npm run dev` still starts locally.

### SF-07 Set NODE_ENV for the scheduled-task install

**`start.bat` line 67:** directly before `call npm run start`, add:

```bat
if not defined NODE_ENV set NODE_ENV=production
if not defined HOST set HOST=0.0.0.0
```

**`install_service.ps1`:** after the param block, if `[Environment]::GetEnvironmentVariable('NODE_ENV','Machine')` is empty, set it to `production` at Machine scope. Print the value either way.

**Test:** none automated (Windows-only scripts). In your report, say what you changed and that the owner must reinstall the task once.

### SF-08 Client cannot skip approval on POST /api/recovery/trigger

**Why:** the route copies `req.body.options` into the trigger options. `options.manual=true` makes the run execute immediately, with no approvers.

**Change, `backend/server.js` around line 1987:**

```js
const triggerOptions = { manual: false, env: req.sentinelEnv || resolveEnvironment(req), initiatedBy };
```

Remove `options = {}` from the destructuring. Add `ignoredOptions: Object.keys(req.body.options || {})` to the `RECOVERY_TRIGGERED` audit entry. Do not change `remediation/recovery.js`: automatic callers pass `manual:false` themselves.

**Test:** add to `tests/recovery_four_eyes.test.js`, or create `tests/security_fixes.test.js`. Start the app the way `tests/phase_o6_restored_screens.test.js` does. Mint an Operator token with `session.generateToken({username:'op.dummy', role:'Operator', environment:'staging'})`. Set `db.updateSettings({autonomousMode:false})`. POST `/api/recovery/trigger` with `{component:'database', options:{manual:true}}` and assert `run.status === 'Awaiting-Approval'`. Stub the Jenkins trigger so nothing leaves the machine.

### SF-09 Allowlist the generic settings update

**Why:** a body without `autonomousMode` is merged into settings unfiltered (`backend/server.js` line 972 calls `db.updateSettings(req.body)`, and `database/db.js` line 532 merges it shallowly). A caller can therefore plant a fake `pendingApproval` with another user's name.

**Change, `backend/server.js` line 972:** replace with an allowlist. Today the UI posts only `autonomousMode`, so the allowlist starts empty:

```js
const WRITABLE_SETTINGS = []; // add UI-editable keys here when the UI needs them
const rejected = Object.keys(req.body || {}).filter(k => !WRITABLE_SETTINGS.includes(k));
if (rejected.length) return res.status(400).json({ error: `Settings not writable: ${rejected.join(', ')}` });
```

**Test:**
- As an SRE Lead, POST `{pendingApproval:{requestedBy:'ghost', signatures:['ghost']}}` and assert 400, with `db.getSettings().pendingApproval` unchanged.
- Then POST `{autonomousMode:true}` with `?env=prod` and assert `autonomousMode` is still `false` (only one real signer).

### SF-10 Dual approval whenever autonomous mode is switched on

**Why:** dual approval applies only when the caller-selected environment is `prod`, but the flag is global and also drives prod runs. Sending `?environment=staging` turns it on for prod with one signature.

**Change, `backend/server.js` line 908:** change `if (wantAutonomous && env === 'prod') {` to `if (wantAutonomous) {`. Keep the rest of the branch. Change the messages that say "in PROD" to "Autonomous mode (all environments)". Add `requestedAt` to the expiry check: if `pending.requestedAt` is more than 4 hours old, treat it as absent and start a new request. Turning it **off** stays single-signer.

Do not change `settings.autonomousMode` to a per-environment object. The front end (`frontend/src/App.jsx` lines 502-512, `frontend/src/components/respond/RemediationView.jsx` lines 55-82) reads it as a boolean.

**Test:** an SRE Lead POSTs `{autonomousMode:true}` with `?environment=staging`. Assert the response has `autonomousMode:false` and a `pendingApproval`. Then confirm the existing O6.3 assertions in `tests/phase_o6_restored_screens.test.js` still pass.

### SF-11 One directory account = one identity

**Why:** login returns the username exactly as typed (`backend/auth/ldap_client.js` line 166). The LDAP filter (line 107) does not escape `*`, `(` or `)`. Approval checks compare names with `===` (`remediation/recovery.js` lines 349 and 365). One person can sign as `jsmith` and `JSMITH` and count as two approvers.

**Change, `backend/auth/ldap_client.js`:**

- Add an RFC 4515 escape function and use it on `username` in the filter at line 107:
  ```js
  // Escapes a value for use inside an LDAP search filter (RFC 4515).
  function escapeFilter(v) { return String(v).replace(/[\\*()\x00]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')); }
  ```
- Count `searchEntry` events. If more than one entry matches, resolve `{ success:false, error:'Ambiguous account' }`.
- Line 166: return `username: String(userEntry.sAMAccountName || username).toLowerCase()`.
- The simulated (staging) path: lower-case the username as well.

**Change, `remediation/recovery.js`:** add a helper and use it at lines 349 and 365:

```js
// Normalises an approver identity for comparison.
function idOf(u) { return String(u || '').trim().toLowerCase(); }
```

**Change, `backend/server.js` line ~932:** the settings four-eyes compare uses `idOf` in the same way. Copy the helper; do not create a new shared module.

**Test:** `tests/recovery_four_eyes.test.js` gains a case: initiator `jsmith` triggers; approval by `JSMITH` must be refused as an SoD violation. Separately, approvals by `a.lead` and `A.LEAD` must count once. For the LDAP part, stub `ldapjs.createClient` with an object whose `search` emits one entry with `sAMAccountName:'jsmith'`. Assert `authenticate('JSMITH','pw')` returns `username:'jsmith'`. Run with `NODE_ENV=production` set in the test, with the credential provider stubbed, and restore env afterwards.

### SF-13 Evidence pack bound to the caller's environment

**`backend/routes/evidenceRoutes.js`, after the not-found check following line 260:**

```js
if ((problem.environment || 'staging').toLowerCase() !== req.sentinelEnv) {
  return res.status(404).json({ error: `Problem not found: ${id}` });
}
```

**Same file, attachments route (around line 388):** if `att.environment` is set and differs from `req.sentinelEnv`, return 404.

**Test:**
- Seed the in-memory problem store with `{id:'PRB-test0001', environment:'prod', title:'dummy'}` (`problem_store.setPool(null)`, see `correlation/problem_store.js`).
- `GET /api/problems/PRB-test0001/evidence?environment=staging` returns 404.
- `GET /api/problems/PRB-test0001/evidence?environment=prod` returns 200 for a Super Admin token.

### SF-14 Session lifetime cap, refresh revocation, logout

**`backend/auth/session.js`:**
- `generateToken` (line 148) accepts an optional `user.auth_time` and writes `auth_time: user.auth_time || now` into the payload.
- `verifyToken` returns `null` when `Date.now() - payload.auth_time > MAX_SESSION_MS`. Use 12 hours, overridable by the env var `SENTINEL_MAX_SESSION_MS`. Skip the check when `auth_time` is absent, so tokens issued before the change still work until they expire.

**`backend/server.js` `/api/environment` (line 454):**
- Pass `auth_time: req.user.auth_time` into `generateToken`.
- After issuing, call `session.revokeToken(req.user.jti, 'environment-switch')`.

**New route in `backend/server.js`, next to login (around line 1023):** `POST /api/auth/logout`. It revokes `req.user.jti` when present, clears `sentinel_session` and `sentinel_csrf`, audit-logs `LOGOUT` and returns `{success:true}`. Add `/api/auth/logout` to the requireAuth early-return list only if an unauthenticated logout must still clear cookies. Otherwise leave it behind requireAuth.

**Front end (optional, only if trivial):** a Logout item in the user menu in `frontend/src/App.jsx` that calls the route and reloads. If you change `frontend/`, run `npm run build` and `node scripts/verify_dist.js --write`.

**Test:**
- With `SENTINEL_MAX_SESSION_MS=1000`, a token with `auth_time = now - 2000` fails `verifyToken`.
- After POST `/api/environment`, the old token fails `verifyToken`.
- After POST `/api/auth/logout`, the token fails `verifyToken`.

### SF-15 WebSocket log lines only to the matching environment

**`backend/server.js` line 322:** replace `global.broadcastLog`:

```js
// Sends a log line only to sockets whose environment matches the line's environment.
global.broadcastLog = (logLine) => {
  const env = (logLine && typeof logLine === 'object' && logLine.environment) || null;
  const payload = JSON.stringify({ type: 'log', data: logLine });
  clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && env && c.environment === env) c.send(payload);
  });
};
```

**String callers:** `broadcastLog` is also called with plain strings. Find them with `grep -n "broadcastLog(" -r backend metrics_collection logger`. For the log-ingest call (around line 848), pass `{ message: <the existing string>, environment: effectiveEnv }`. For other string callers, pass the environment they already have. If none is available, wrap the string as `{ message, environment: 'staging' }` and list the call in your report.

**Front end:** `frontend/src/App.jsx` around lines 459-464 must still display objects. Check that it renders `data.message` when `data` is an object. Adjust only if it does not.

**Test:**
- Start the server on loopback and open two `ws` clients, one with `?environment=staging` and one with `?environment=prod` (Super Admin token).
- Call `global.broadcastLog({message:'X', environment:'prod'})` in-process.
- Only the prod client receives it.

### SF-16 Git canary step refuses symlinks

**`synthetics/steps/git.js`:**
- Line 292: `const cloneArgs = ['-c', 'core.symlinks=false', 'clone', '--depth', '1', '--no-tags', '--quiet'];`. Check how `git()` builds argv; `-c` must come before `clone`.
- Before line 311, validate the file name and the target:

  ```js
  const name = step.canary_file || '.sentinel-canary';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('canary_file must be a plain file name');
  const target = path.join(cloneDir, name);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('canary path is a symlink; refusing to write');
  fs.writeFileSync(target, stamp, { flag: 'w' });
  ```

  Use `name` in the following `git add` call too.

**Test:** extend `tests/phase_q_git_push_reset.test.js`, which already uses local bare repos with `file://`.
- Create a bare repo whose canary branch commits `.sentinel-canary` as a symlink to a scratch `victim.txt`.
- Run the step.
- Assert the step reports an error and `victim.txt` is unchanged.
- Skip the case on Windows if creating a symlink throws `EPERM`, and log the skip.

### SF-18 Role gates on unrestricted state-changing routes

Add `requireRole(SRE_LEAD_PLUS)` (from `backend/auth/require_role.js` line 9) to these routes:

| Route | Location |
|---|---|
| `POST /:id/run` and `POST /run-all` | `backend/routes/healthCheckRoutes.js` |
| `POST /hosts/:host/processes/:pid/dump` | `backend/routes/infraRoutes.js` line 234 |
| `POST /api/v2/events` | `backend/server.js` line 1804; also force `event.environment = req.sentinelEnv` |
| `POST /api/v2/correlation/trigger` | `backend/server.js` |
| `POST /api/v2/rca/hypotheses/:id/verdict` | `backend/server.js` |

**Test:** a Viewer token gets 403 on each route, and an SRE Lead token is not 403. Check the existing tests that call these routes and update their tokens if they used a Viewer or Operator.

### SF-08 to SF-18 wrap-up

- Add every new test file to `test:all`.
- Update the matching rows in `docs/SECURITY_FIX_PLAN.md`: tick `[x]` and correct any line numbers your edits moved.
- Run `npm test`, all five lints and `npm run config:check`.

## 3. Out of scope for you (the owner does these)

| Task | Why not you |
|---|---|
| SF-01, SF-02, SF-03 Node.js upgrade on servers, CI agents and fleet | Machine installs. You may change `.nvmrc` to `24.22.1`, add `"engines": {"node": ">=24.22.1 <25"}` to `package.json`, and set `nodejs (>= 22.23.4)` at lines 18 and 21 of `agent/packaging/nfpm.yaml`. Do those three edits as one commit, `SF-01/03: runtime floors`. |
| SF-04 PHP inventory | Fleet data. Sentinel has no PHP. |
| SF-05 npm audit | Needs registry access. Run it only if your machine has it, and report the output; do not upgrade packages without the owner. |
| SF-12 Jenkinsfile | `deployments/Jenkinsfile` deploys to the real fleet. You may make the code change described in `docs/SECURITY_FIX_PLAN.md` SF-12, but do not run the pipeline. |
| SF-17 second audit, SF-20 release | Owner process. |

## 4. Stop and ask if

- a fix makes an existing test fail and you cannot tell whether the test or the fix is wrong;
- the front end depends on a behaviour you are removing (for example a settings key other than `autonomousMode`);
- any task would need a new npm dependency;
- you find a security problem not listed here (note it, do not fix it).

## 5. Report back

When done, reply with:

1. A table with one row per task: ID, files changed, test added, result (pass/fail/skipped and why).
2. The output summary of `npm test` and each lint, before and after.
3. The git log of your branch (`git log --oneline`).
4. Anything you could not do, with the reason.
5. A reminder for the owner to restart both Sentinel nodes, reinstall the scheduled task (if used), and rebuild the front end if `frontend/` changed.
