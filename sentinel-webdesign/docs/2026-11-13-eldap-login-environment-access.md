# eLDAP Login Page and Per-User Environment Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users sign in on a Sentinel login page with their AD username and password, and each user sees only the environments (STG, PROD or both) their directory groups grant, with a seam for SSO later.

**Architecture:** Directory groups decide two separate things: the role (existing `role_mappings`) and the environments (new `security.environment_groups`). The environments travel in the session JWT as an `environments` claim, so every existing entitlement check (`accessPolicy.isEntitled`, used by the `/api` middleware, `/api/environment` and the WebSocket) enforces them with no route changes. The SPA gets a sign-in gate: when `/api/auth/me` returns 401 it shows `LoginPage`, and any later 401 sends the user back there.

**Tech Stack:** Node 24 / Express 4, ldapjs 3.0.7 (client, and `ldap.createServer` for the test directory), HS256 JWT in `backend/auth/session.js`, React 19 + Vite, Playwright for UI tests, plain `node` + `assert` tests.

**Spec:** This plan's "Design decisions" section below (agreed in chat on 2026-11-13). There is no separate spec document.

## Design decisions

1. **One server, mixed users.** The app already keeps the environment per session (JWT `environment` claim) and checks it on every `/api` request and WebSocket subscribe. A STG-only user and a PROD-only user can be signed in at the same time on the same server. What is missing is a per-user grant: today `security.environment_entitlements` maps **roles** to environments, so every SRE Lead gets the same environments.
2. **Environment access comes from AD groups**, independent of role. New config:
   ```yaml
   security:
     environment_groups:
       "cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp": [prod]
       "cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp": [staging]
   ```
   A user's environments are the union over their groups. When `environment_groups` is empty or absent, the existing role-based `environment_entitlements` rule applies unchanged, so current deployments behave as today. Super Admin keeps access to all environments (existing rule).
3. **No access, no session.** A real LDAP user with no mapped role group is refused (`403 "Your account is not in a Sentinel access group."`); the old silent fallback to `Operator` is removed for real binds. A user whose groups grant zero environments is refused the same way, with a message naming the environment groups. The staging test-user table keeps its `Operator` fallback.
4. **First environment after sign-in:** the server's configured environment (`config.ENVIRONMENT`) if the user is entitled to it, otherwise the first of the user's environments in the order `prod`, `staging`.
5. **Real LDAP outside production** when `SENTINEL_AUTH_MODE=ldap`, so the staging host can use real eLDAP now. Default behaviour (production uses LDAP, everything else uses the staging test users) is unchanged, so the existing 91 test files keep passing.
6. **SSO later:** both sign-in paths will call one function, `issueSession(res, user)`, in `backend/auth/issue_session.js`. A future OIDC/SAML callback calls it with a user object of the same shape (`username, role, email, environments, authenticatedVia`). No SSO code is written now.
7. **Sign-out:** the user menu's "Lock Session" becomes "Sign out", calling `POST /api/auth/logout` and returning to the login page.

## Global Constraints

- Node engine `>=24.22.1 <25` (`package.json`); do not add dependencies; ldapjs stays at 3.0.7.
- Role names are exactly `Super Admin`, `SRE Lead`, `NOC Operator`, `Viewer`, `Operator`. Environment ids are exactly `prod`, `staging` (`demo` is never grantable).
- Never log or return passwords; the login error for wrong credentials stays `Invalid LDAP credentials or bind failed.` (no user enumeration: "user not found" also returns this text to the client).
- Line endings: keep LF on every file (`.gitattributes`); comments one line, plain English, as in the existing code.
- `frontend/dist` is committed: run `npm run build` after frontend changes and commit `dist`; `npm run verify:dist` must pass.
- Every new frontend file must be imported from `main.jsx`'s tree (`npm run lint:unreferenced`).
- Every new test file is appended to `test:all` in `package.json`.
- The repo must be a git repository before Task 1. If `.git` is missing: `git init`, `git add -A`, verify `.env` and `config/.env` are not staged, commit "chore: baseline before login work".

## Review Focus

- **A STG-only user forces PROD in the URL** (`?environment=prod`, `X-Sentinel-Environment: prod`, WebSocket `subscribe` to prod): every one must be refused with 403 or ignored. Test in Task 3.
- **Session expiry or revocation while the page is open** (12-hour cap, sign-out in another tab): the next API call returns 401 and the UI must show the login page, not a "healthy" dashboard with zeros. Test in Task 5.
- **Username typed with different case or as UPN/email** (`Praveen`, `praveen@enterprise.corp`): one canonical session username (`sAMAccountName`, lower case), so four-eyes approval still sees one person. Test in Task 2.
- **Directory unreachable or bind credential missing:** the login page shows "Sign-in service unavailable. Try again or contact the Sentinel admins." and the server does not crash or fall back to simulated login. Test in Task 2 (server stopped) and Task 5 (message shown).
- **User in both environment groups switches back and forth:** the switcher shows both chips and each switch keeps working after token rotation; a single-environment user sees only their chip. Test in Task 5.

---

### Task 1: Per-user environments in the access policy and the session token

**Files:**
- Modify: `backend/auth/access_policy.js` (add `environmentsFromGroups`, `defaultEnvironment`; change `allowedEnvironments`)
- Modify: `backend/auth/session.js:148-163` (`generateToken` payload)
- Modify: `config/global.yaml:205-211` (document `environment_groups`, commented example, empty by default)
- Test: `tests/env_access.test.js` (new; this task adds the unit section)

**Interfaces:**
- Produces: `environmentsFromGroups(memberOf: string[]): string[] | null` — union of mapped environments for the DNs (case-insensitive DN compare), `null` when `security.environment_groups` is empty or absent (meaning "not configured, use roles").
- Produces: `allowedEnvironments(user)` — rule order: no user → all; `Super Admin` → all; `Array.isArray(user.environments)` → that list filtered to `['prod','staging']`; else the existing role rule.
- Produces: `defaultEnvironment(user, configured: string): string | null` — decision 4; `null` when the user has no environments.
- Produces: JWT payload gains `environments: string[]` when `user.environments` is an array (omitted otherwise, so old tokens and staging users keep the role rule).

- [ ] **Step 1: Write the failing unit tests** in `tests/env_access.test.js` (section "unit"), loading `access_policy` with a stubbed `yamlConfig.loadGlobalConfig` (same stub approach as `tests/environment_isolation.test.js`):

```js
// with environment_groups = { 'CN=Sentinel-Env-Prod,OU=Groups,DC=enterprise,DC=corp': ['prod'],
//                             'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp': ['staging'] }
assert.deepStrictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=groups,dc=enterprise,dc=corp']), ['prod']);
assert.deepStrictEqual(policy.environmentsFromGroups(['cn=other,dc=x']), []);
assert.deepStrictEqual(policy.environmentsFromGroups([
  'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp', 'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp']).sort(), ['prod', 'staging']);
assert.deepStrictEqual(policy.allowedEnvironments({ role: 'SRE Lead', environments: ['staging'] }), ['staging']);
assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Viewer', environments: ['prod', 'demo'] }), ['prod']);
assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Super Admin', environments: ['staging'] }), ['prod', 'staging']);
assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod'] }, 'staging'), 'prod');
assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod', 'staging'] }, 'staging'), 'staging');
assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: [] }, 'staging'), null);
// with environment_groups = {}:
assert.strictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp']), null);
// token round trip:
const t = session.generateToken({ username: 'a', role: 'Viewer', environments: ['staging'] });
assert.deepStrictEqual(session.verifyToken(t).environments, ['staging']);
assert.strictEqual('environments' in session.verifyToken(session.generateToken({ username: 'b', role: 'Viewer' })), false);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/env_access.test.js`
Expected: FAIL, `policy.environmentsFromGroups is not a function`.

- [ ] **Step 3: Implement** the three functions in `access_policy.js` (export them) and the `environments` claim in `generateToken`. In `global.yaml` add under `security:` the `environment_groups: {}` key with the two commented example lines from decision 2.

- [ ] **Step 4: Run the new test and the existing isolation tests**

Run: `node tests/env_access.test.js && node tests/environment_isolation.test.js && node tests/security_fixes.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/auth/access_policy.js backend/auth/session.js config/global.yaml tests/env_access.test.js package.json
git commit -m "feat(auth): per-user environment access from directory groups"
```

---

### Task 2: Real eLDAP sign-in on demand, with group-based environments

**Files:**
- Modify: `backend/auth/ldap_client.js` (`authenticate`, `performLdapBind`, `STAGING_TEST_USERS`)
- Create: `tests/fixtures/ldap_test_directory.js` (in-process directory for tests)
- Test: `tests/ldap_bind.test.js` (new)

**Interfaces:**
- Consumes: `environmentsFromGroups` (Task 1).
- Produces: `authenticate(username, password)` resolves to `{ success: true, user: { username, role, email, environments?: string[], authenticatedVia: 'LDAP_BIND' | 'STAGING_SIMULATION' } }` or `{ success: false, error: string, code: 'BAD_CREDENTIALS' | 'NO_ACCESS' | 'UNAVAILABLE' }`. `user.memberOf` and `user.dn` are no longer returned (they must not reach the JWT).
- Produces: `startTestDirectory({ users }) -> Promise<{ url: string, bindDn: string, bindPassword: string, stop(): Promise<void> }>` in the fixture, where `users` is `[{ sAMAccountName, password, mail, memberOf: string[] }]`, base `dc=enterprise,dc=corp`, listening on `127.0.0.1` port 0.

- [ ] **Step 1: Write the fixture** with `ldap.createServer()`: `bind` handler accepts the service DN/password and each user's DN/password, `search` handler matches `sAMAccountName`, `userPrincipalName` or `mail` equality from the parsed filter and returns `dn, sAMAccountName, mail, memberOf`.

- [ ] **Step 2: Write the failing tests** in `tests/ldap_bind.test.js`. Set `process.env.SENTINEL_AUTH_MODE = 'ldap'`, `SSO_ELDAP_BIND` to the fixture's bind password, and stub `loadGlobalConfig` so `sso_ldap_config.ldap_url` is the fixture URL and `security.environment_groups` is the decision-2 map. Users: `stg.user` (groups `sentinel-operators`, `sentinel-env-staging`), `prod.user` (`sentinel-readonly`, `sentinel-env-prod`), `both.user` (`sentinel-sreleads`, both env groups), `nogroup.user` (no groups), `noenv.user` (`sentinel-operators` only).

```js
let r = await ldap.authenticate('stg.user', 'Pw1!');
assert.strictEqual(r.success, true); assert.strictEqual(r.user.role, 'NOC Operator');
assert.deepStrictEqual(r.user.environments, ['staging']); assert.strictEqual(r.user.authenticatedVia, 'LDAP_BIND');
assert.strictEqual('memberOf' in r.user, false);
r = await ldap.authenticate('STG.User', 'Pw1!');               assert.strictEqual(r.user.username, 'stg.user');
r = await ldap.authenticate('stg.user@enterprise.corp', 'Pw1!'); assert.strictEqual(r.user.username, 'stg.user');
r = await ldap.authenticate('prod.user', 'Pw1!');               assert.deepStrictEqual(r.user.environments, ['prod']);
r = await ldap.authenticate('both.user', 'Pw1!');               assert.deepStrictEqual(r.user.environments.sort(), ['prod', 'staging']);
r = await ldap.authenticate('stg.user', 'wrong');               assert.strictEqual(r.code, 'BAD_CREDENTIALS');
r = await ldap.authenticate('ghost', 'Pw1!');                   assert.strictEqual(r.code, 'BAD_CREDENTIALS');
assert.strictEqual(r.error, 'Invalid LDAP credentials or bind failed.');
r = await ldap.authenticate('nogroup.user', 'Pw1!');            assert.strictEqual(r.code, 'NO_ACCESS');
r = await ldap.authenticate('noenv.user', 'Pw1!');              assert.strictEqual(r.code, 'NO_ACCESS');
await dir.stop();
r = await ldap.authenticate('stg.user', 'Pw1!');                assert.strictEqual(r.code, 'UNAVAILABLE');
assert.notStrictEqual(r.user && r.user.authenticatedVia, 'STAGING_SIMULATION');
```

- [ ] **Step 3: Run to verify it fails**

Run: `node tests/ldap_bind.test.js`
Expected: FAIL (`authenticatedVia` is `STAGING_SIMULATION`, because real LDAP runs only in production).

- [ ] **Step 4: Implement in `ldap_client.js`:**
  - Real path when `NODE_ENV === 'production'` (existing rule) **or** `process.env.SENTINEL_AUTH_MODE === 'ldap'`; the simulated opt-in never overrides `SENTINEL_AUTH_MODE=ldap`.
  - Search base: `ldapConfig.search_base || ldapConfig.base_dn || 'dc=enterprise,dc=corp'` (fixes the `search_base` vs `base_dn` key mismatch).
  - When `ldapConfig.tls_ca_file` is set, pass `tlsOptions: { ca: [fs.readFileSync(tls_ca_file)] }` to both `createClient` calls.
  - `resolveRoleFromGroups` returns `null` for no match; on the real path `null` → `{ success:false, code:'NO_ACCESS', error:'Your account is not in a Sentinel access group.' }`.
  - `environments = accessPolicy.environmentsFromGroups(memberOf)`; when it is an empty array (configured, no match) and the role is not `Super Admin` → `NO_ACCESS` with `'Your account has no Sentinel environment access (groups: sentinel-env-prod / sentinel-env-staging).'`; when `null`, omit `environments`.
  - Connection, service-bind and search errors → `code: 'UNAVAILABLE'`, `error: 'Sign-in service unavailable. Try again or contact the Sentinel admins.'`. "User not found" → `BAD_CREDENTIALS` with the standard text.
  - Staging test users: add `stg_operator` (`NOC Operator`, `['staging']`) and `prod_operator` (`NOC Operator`, `['prod']`); existing test users keep no `environments` (role rule).

- [ ] **Step 5: Run the new and existing LDAP and login tests**

Run: `node tests/ldap_bind.test.js && node tests/ldap_client.test.js && node tests/prod_login_lockdown.test.js && node tests/auth_lockdown.test.js`
Expected: all PASS. If `ldap_client.test.js` asserts the `Operator` fallback for an unmapped real-LDAP user, update that assertion to `NO_ACCESS` (decision 3) and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add backend/auth/ldap_client.js tests/fixtures/ldap_test_directory.js tests/ldap_bind.test.js tests/ldap_client.test.js package.json
git commit -m "feat(auth): real eLDAP sign-in outside production, group-based environments, deny unmapped users"
```

---

### Task 3: Sign-in, me and environment-switch routes use the user's environments

**Files:**
- Create: `backend/auth/issue_session.js`
- Modify: `backend/server.js` — `POST /api/auth/sso/login` (~line 1047), `POST /api/environment` (~line 458), `GET /api/auth/me` (~line 1112)
- Test: `tests/env_access.test.js` (add section "http")

**Interfaces:**
- Consumes: `authenticate` result shape (Task 2), `allowedEnvironments`, `defaultEnvironment` (Task 1).
- Produces: `issueSession(res, user) -> { token: string, csrfToken: string }` — signs the token with `generateToken(user)`, sets `sentinel_session` (httpOnly, SameSite=Strict, Secure in production, 8 h) and `sentinel_csrf` cookies exactly as the login route does today. Both the login route and the environment switch use it; a future SSO callback will too.
- Produces: login response `{ authenticated: true, csrfToken, user: { username, role, email, environment, allowedEnvironments } }` (keep `token` for API clients). Status codes: 400 missing fields, 401 `BAD_CREDENTIALS`, 403 `NO_ACCESS`, 503 `UNAVAILABLE`.
- Produces: `/api/auth/me` returns `allowedEnvironments: accessPolicy.allowedEnvironments(user)` (replaces the duplicated role lookup at ~line 1123).
- Changes: in the WebSocket connection handler (~line 2280), when `allowedEnvironments(wsUser)` is empty, close the socket with code 1008 and stop; do not fall back to `'staging'`.

- [ ] **Step 1: Write the failing HTTP tests** (start `server.js`'s `app` on port 0 like `tests/security_fixes.test.js`; staging test users, so no directory needed):

```js
// stg_operator signs in -> lands on staging, sees only staging
let r = await post('/api/auth/sso/login', { username: 'stg_operator', password: 'Pw1!' });
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body.user.environment, 'staging');
assert.deepStrictEqual(r.body.user.allowedEnvironments, ['staging']);
const stg = r.body.token;
assert.strictEqual((await get('/api/alerts?environment=prod', stg)).status, 403);
// The session environment wins over the header (resolveEnvironment order), so this is staging data:
r = await get('/api/alerts', stg, { 'X-Sentinel-Environment': 'prod' });
assert.strictEqual(r.status, 200); assert.ok(r.body.every(a => a.environment !== 'prod'));
assert.strictEqual((await post('/api/environment', { environment: 'prod' }, stg)).status, 403);
assert.strictEqual((await get('/api/alerts?environment=staging', stg)).status, 200);
// prod_operator lands on prod even though the server default is staging
r = await post('/api/auth/sso/login', { username: 'prod_operator', password: 'Pw1!' });
assert.strictEqual(r.body.user.environment, 'prod');
const prod = r.body.token;
assert.strictEqual((await get('/api/alerts?environment=staging', prod)).status, 403);
assert.deepStrictEqual((await get('/api/auth/me', prod)).body.allowedEnvironments, ['prod']);
// both users at once: the staging session is unaffected by the prod session
assert.strictEqual((await get('/api/auth/me', stg)).body.environment, 'staging');
// WebSocket: asking for prod is downgraded to the user's first allowed environment
// (server.js ~line 2280), and a later subscribe to prod is ignored
const ws = await wsOpen('/ws?environment=prod', stg);
assert.strictEqual((await ws.next('init')).data.environment, 'staging');
ws.send({ type: 'subscribe', environment: 'prod' });
assert.strictEqual(await ws.nextOrNull('init', 1000), null);
ws.close();
// Super Admin keeps both
r = await post('/api/auth/sso/login', { username: 'admin_sentinel', password: 'Pw1!' });
assert.deepStrictEqual(r.body.user.allowedEnvironments.sort(), ['prod', 'staging']);
```

`wsOpen(path, token)` is a small helper in the test file over the `ws` package: it returns `{ next(type), nextOrNull(type, ms), send(obj), close() }`. Before writing the assertion, check which field of the `init` message carries the environment and use that field.

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/env_access.test.js`
Expected: FAIL at `user.environment` (`undefined`).

- [ ] **Step 3: Implement** `issue_session.js` and the three route changes: login maps `code` to the status codes above, sets `user.environment = defaultEnvironment(user, config.ENVIRONMENT)` (403 `NO_ACCESS` when `null`), calls `issueSession`, and returns the new response shape; `/api/environment` calls `issueSession` after revoking the old `jti`; `/api/auth/me` uses `accessPolicy.allowedEnvironments`.

- [ ] **Step 4: Run the auth-related suites**

Run: `node tests/env_access.test.js && node tests/security_fixes.test.js && node tests/environment_isolation.test.js && node tests/auth_lockdown.test.js && node tests/prod_login_lockdown.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/auth/issue_session.js backend/server.js tests/env_access.test.js
git commit -m "feat(auth): sign-in lands on an entitled environment; one session issuer for login, switch and future SSO"
```

---

### Task 4: Login page and sign-in gate in the UI

**Files:**
- Create: `frontend/src/auth.js`
- Create: `frontend/src/components/auth/LoginPage.jsx`, `frontend/src/components/auth/LoginPage.css`
- Modify: `frontend/src/api.js` (`apiFetch`: on 401 dispatch the auth event)
- Modify: `frontend/src/App.jsx` — sign-in gate around the shell (~line 222-233), user menu "Lock Session" → "Sign out" (~line 800-805), environment chips filtered by `currentUser.allowedEnvironments` (~line 813-826)
- Modify: `frontend/dist/**` (rebuild)

**Interfaces:**
- Consumes: login and `/api/auth/me` response shapes (Task 3), `POST /api/auth/logout`.
- Produces in `auth.js`: `fetchMe(): Promise<User | null>` (null on 401), `signIn(username, password): Promise<{ ok: true, user } | { ok: false, status: number, error: string }>`, `signOut(): Promise<void>`, `AUTH_REQUIRED_EVENT = 'sentinel:auth-required'`.
- Produces: `<LoginPage onSignedIn={(user) => void} notice={string | null} />`.

- [ ] **Step 1: Implement `auth.js`** using `apiFetch` (CSRF header comes from the `sentinel_csrf` cookie, which `/api/auth/sso/status` sets; call that once before the first sign-in when the cookie is absent).

- [ ] **Step 2: Implement `LoginPage`:** fields with stable ids `login-username` and `login-password`, labels "Username" and "Password", button "Sign in"; a line under the button "Sign in with your corporate AD account." Errors shown in an `role="alert"` element with the server's `error` text; 429 shows "Too many sign-in attempts. Wait 15 minutes and try again."; network failure or 503 shows "Sign-in service unavailable. Try again or contact the Sentinel admins." Disable the button while the request runs. The page uses the app's theme variables so it works in light and dark.

- [ ] **Step 3: Gate the app in `App.jsx`:** state `authState: 'checking' | 'signed-out' | 'signed-in'`. On mount call `fetchMe()`. `'checking'` renders a blank shell with "Checking your session…"; `'signed-out'` renders only `LoginPage` (no sidebar, no dashboards, no WebSocket); `'signed-in'` renders the existing shell and sets `environment` to `user.environment`. Listen for `AUTH_REQUIRED_EVENT` → `'signed-out'` with notice "Your session ended. Sign in again." Close the WebSocket on sign-out.

- [ ] **Step 4: User menu and switcher:** replace "🔒 Lock Session" with "Sign out" calling `signOut()` then setting `'signed-out'`; render an environment chip only when its id is in `currentUser.allowedEnvironments`.

- [ ] **Step 5: In `api.js`,** when a response is 401 and the URL is not `/api/auth/sso/login`, dispatch `AUTH_REQUIRED_EVENT` on `window` (still return the response).

- [ ] **Step 6: Build and static checks**

Run: `npm run build && npm run verify:dist && npm run lint`
Expected: build succeeds, `frontend/dist matches frontend/src`, lint clean (including `lint:unreferenced`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/dist
git commit -m "feat(ui): eLDAP login page, sign-in gate, sign out, environment chips per user"
```

---

### Task 5: UI tests for sign-in and per-user environments

**Files:**
- Modify: `tests/ui_smoke.test.js` (sign in before visiting views)
- Create: `tests/ui_login.test.js`
- Modify: `package.json` (`test:all`)

**Interfaces:**
- Consumes: element ids and copy from Task 4; staging test users `stg_operator`, `prod_operator`, `admin_sentinel` (Task 2).

- [ ] **Step 1: Update `ui_smoke.test.js`:** before Test 1, open `/`, fill `#login-username` with `admin_sentinel`, `#login-password` with any non-denied password, click "Sign in", wait for the sidebar. All existing assertions stay.

- [ ] **Step 2: Write `tests/ui_login.test.js`** (same server and Playwright setup as `ui_smoke`):

```js
// 1. Signed out: login page, no dashboard text, no WebSocket opened
await page.goto(base + '/');
await page.waitForSelector('#login-username');
assert.strictEqual(await page.getByText('Active Problems').count(), 0);
// 2. Wrong password shows the server error
await signIn(page, 'stg_operator', 'wrong_password');
await page.getByRole('alert').getByText('Invalid LDAP credentials or bind failed.').waitFor();
// 3. stg_operator: only the STAG chip, lands on staging
await signIn(page, 'stg_operator', 'Pw1!');
assert.strictEqual(await page.locator('.env-chip', { hasText: 'PROD' }).count(), 0);
assert.strictEqual(await page.locator('.env-chip', { hasText: 'STAG' }).count(), 1);
// 4. Sign out returns to the login page and the old cookie no longer works
await page.locator('.logged-user-card').click(); await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForSelector('#login-username');
// 5. prod_operator: only PROD, lands on prod
await signIn(page, 'prod_operator', 'Pw1!');
assert.ok(page.url().includes('env=prod'));
assert.strictEqual(await page.locator('.env-chip', { hasText: 'STAG' }).count(), 0);
// 6. Session revoked in the background -> next action shows the login page with the notice
await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': document.cookie.match(/sentinel_csrf=([^;]+)/)[1] } }));
await page.getByRole('button', { name: 'Problems' }).click();
await page.getByText('Your session ended. Sign in again.').waitFor();
// 7. Super Admin sees both chips and can switch twice without landing on the login page
```

- [ ] **Step 3: Run**

Run: `node tests/ui_login.test.js && node tests/ui_smoke.test.js`
Expected: both PASS.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: `[run_tests] 94 test file(s) passed.` (91 existing + `env_access`, `ldap_bind`, `ui_login`).

- [ ] **Step 5: Commit**

```bash
git add tests/ui_smoke.test.js tests/ui_login.test.js package.json
git commit -m "test(ui): sign-in flow and per-user environment chips"
```

---

### Task 6: Operator setup notes

**Files:**
- Modify: `docs/PRODUCTION_READINESS_PLAN.md` (new section "Sign-in and environment access")
- Modify: `.env.example` (add `SENTINEL_AUTH_MODE` with comment)

- [ ] **Step 1: Write the section** covering exactly: the AD groups to request (four role groups already in `config/infra/sso-eldap.yaml`, plus `sentinel-env-prod` and `sentinel-env-staging`); the `security.environment_groups` block to paste; `sso_ldap_config.base_dn`, `tls_ca_file` and the CyberArk bind object `ELDAP-BIND-SVC` (or `SSO_ELDAP_BIND` for staging); on the staging host set `SENTINEL_AUTH_MODE=ldap` and `security.require_auth_for_reads: true` so the APIs are not readable without signing in; how to check: `npm run readiness`, then sign in as one STG-only and one PROD-only test account.

- [ ] **Step 2: Commit**

```bash
git add docs/PRODUCTION_READINESS_PLAN.md .env.example
git commit -m "docs: sign-in and environment access setup"
```
