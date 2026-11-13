# Sentinel: Rework and New Implementation Work Order (multi-agent)

**Project:** Sentinel (SENTINEL-V2), repo root `sentinel-webdesign/`
**Prepared:** 13 Nov 2026, from the full test run of 13 Nov 2026 (91/91 tests passing, 32/32 screens loading)
**Audience:** an orchestrator agent and the worker agents it starts (Gemini multi-agent). Every agent reads sections 1 to 4 before its own work package.
**Detailed companion spec:** `docs/superpowers/plans/2026-11-13-eldap-login-environment-access.md`. It holds the exact test code for items N1 to N5. Where this document and that plan differ, this document wins.

---

## 1. What is being built

| ID | Item | Type | Priority |
|---|---|---|---|
| N0 | Git repository and baseline commit | New | Blocker for all |
| N1 | Per-user environment access from AD groups, carried in the session token | New | High |
| N2 | Real eLDAP sign-in outside production (`SENTINEL_AUTH_MODE=ldap`), includes R7 and R8 | New | High |
| N3 | Sign-in, `/api/auth/me` and environment-switch routes use the user's environments; one session issuer for SSO later | New | High |
| N4 | Login page, sign-in gate, Sign out, environment chips per user | New | High |
| N5 | UI tests for sign-in and per-user environments | New | High |
| N6 | Operator setup notes | New | Medium |
| R1 | UI shows "healthy" zeros when data fails to load | Rework | High |
| R2 | "Alert Detection Latency" SLO is hard-coded at 98.4% | Rework | High |
| R3 | CORS rejects the app's own address (blank page) and answers 500 | Rework | Medium |
| R4 | SLO cards unreadable in the light theme | Rework | Medium |
| R5 | Red badge on "Problems" counts recovery approvals | Rework | Low |
| R6 | Recovery trigger for an unknown component returns success | Rework | Low |
| R7 | AD user with no Sentinel group signs in as Operator (fixed inside N2) | Rework | High |
| R8 | LDAP search uses `search_base`, config has `base_dn` (fixed inside N2) | Rework | Medium |
| R9 | Minor UI: contrast, Google Fonts, phone sidebar, Viewer buttons, stale rota warning | Rework | Low |

Out of scope: SSO/OIDC sign-in itself, database or ClickHouse setup, Jenkins/ServiceNow integration, any change to the 11 security fixes SF-06 to SF-18 (they are verified; do not refactor them).

---

## 2. Agents and how they work together

| Agent | Owns | Work packages |
|---|---|---|
| **ORCH** (orchestrator) | Branches, merges, the full test run after every merge, the final report | N0, merges, final verification |
| **AUTH** (backend) | `backend/auth/**`, auth routes and the WebSocket handler in `backend/server.js`, `config/global.yaml` `security:` and `sso_ldap_config:` blocks | WP-AUTH = N1, N2 (with R7, R8), N3 |
| **API** (backend) | `backend/services/slo/**`, CORS block and recovery-trigger route in `backend/server.js`, `backend/cors_validator.js` | WP-API = R2, R3, R6 |
| **UI** (frontend) | `frontend/src/**`, `frontend/dist/**` | WP-UI-1 = R4, R5, R9; WP-UI-2 = N4, R1 |
| **QA** (tests) | `tests/ui_login.test.js`, `tests/ui_smoke.test.js`, final regression | WP-QA = N5, independent verification |
| **DOCS** | `docs/PRODUCTION_READINESS_PLAN.md`, `.env.example` | WP-DOCS = N6 |
| **REVIEW** | Read-only | Reviews every work package before ORCH merges it |

### Waves

```
Wave 0  ORCH: N0 (git init, baseline, npm test = 91 pass)
Wave 1  in parallel:  AUTH: WP-AUTH (N1 -> N2 -> N3, in that order)
                      API:  WP-API (R2, R3, R6)
                      UI:   WP-UI-1 (R4, R5, R9)
Wave 2  after WP-AUTH is merged, in parallel:
                      UI:   WP-UI-2 (N4, R1)       needs N3's API contract
                      DOCS: WP-DOCS (N6)           needs N1-N3 config keys
Wave 3  after WP-UI-2 is merged:  QA: WP-QA (N5 + full regression)
Final   ORCH: full verification (section 9), report
```

### Branch and merge rules

1. ORCH creates one branch per work package from `main` after N0: `wp/auth`, `wp/api`, `wp/ui-1`, `wp/ui-2`, `wp/docs`, `wp/qa`. Wave 2 and 3 branches start from `main` after the previous wave is merged.
2. Each agent commits only on its own branch, one commit per item (for example `R2: compute alert detection SLO from data or report UNKNOWN`).
3. Before merging, REVIEW checks the work package against its acceptance criteria and the global rules, and answers APPROVE or CHANGES (with file:line and what to change).
4. ORCH merges in this order inside a wave: `wp/auth`, then `wp/api`, then `wp/ui-1`. After each merge ORCH runs `npm test` and `npm run lint`. If anything fails, ORCH sends it back to the owning agent and does not merge the next branch.
5. **Shared file `backend/server.js`:** AUTH and API both edit it in Wave 1. Each edits only the regions listed in its work package. Do not reformat, reorder or move any other code in that file. Merge conflicts are resolved by ORCH, keeping both changes.
6. **Shared file `package.json`:** only the `test:all` script line changes. Each agent appends its test files at the end of that line. ORCH resolves conflicts by keeping all appended files.

---

## 3. Global rules (every agent)

1. **Environment:** Node `>=24.22.1 <25` (`.nvmrc` says 24.22.1). No new npm dependencies. `ldapjs` stays at 3.0.7. Install with `npm ci`, then `npm run setup` if a `@sentinel/*` require fails.
2. **Line endings stay LF.** `.gitattributes` enforces it. Never commit CRLF in `.sh`, `.service`, `.flags`, `.conf`, `.yaml`, `.yml`, `.js`, `.jsx`, `.css`.
3. **Never fabricate data** in prod or staging. Missing data is `null` / `DATA_UNAVAILABLE` / UNKNOWN. Only the `demo` view may show sample data. `npm run lint:random` and `npm run lint:samples` must pass.
4. **No live systems.** Do not contact any real LDAP, CyberArk, Jenkins, ServiceNow or bank host. LDAP tests use the in-process test directory from N2.
5. **Secrets:** never commit `.env` or `config/.env`. Never log or return passwords.
6. **Comments:** one line, plain English, matching the existing style. No commented-out code.
7. **Frontend build:** `frontend/dist` is committed. After any frontend change run `npm run build`, commit `frontend/dist`, and `npm run verify:dist` must print `frontend/dist matches frontend/src`. Every new frontend file must be reachable from `main.jsx` (`npm run lint:unreferenced`).
8. **Tests:** plain `node` + `assert`, one file per feature under `tests/`, added to `test:all` in `package.json`. Server tests start `backend/server.js`'s exported app on port 0 (copy the setup in `tests/security_fixes.test.js`). UI tests use Playwright like `tests/ui_smoke.test.js`.
9. **Role names** exactly `Super Admin`, `SRE Lead`, `NOC Operator`, `Viewer`, `Operator`. **Environment ids** exactly `prod`, `staging` (`demo` is never grantable).
10. **Stay in your files.** If you need a change in a file another agent owns, stop and report it to ORCH (section 8).

---

## 4. Facts about the code (verified 13 Nov 2026)

- The session environment lives in the JWT `environment` claim. `resolveEnvironment(req)` (`backend/server.js` ~line 104) takes, in order: `?environment`, `?env`, the session's environment, then the `X-Sentinel-Environment` header.
- The `/api` middleware (~line 288) refuses with 403 when `accessPolicy.isEntitled(req.user, env)` is false. The WebSocket handler (~line 2280) downgrades an unentitled environment to the user's first allowed one, and ignores `subscribe` to an unentitled one.
- `backend/auth/access_policy.js` decides environments **per role** from `security.environment_entitlements` in `config/global.yaml` (empty by default, meaning every role sees everything). Super Admin always sees both.
- `backend/auth/ldap_client.js`: the real LDAP bind runs only when `NODE_ENV=production`. Otherwise a staging test-user table is used (any password not on the deny list; unknown usernames become `Operator`). The real path falls back to `Operator` when no group matches (R7), and reads `search_base` while `global.yaml` defines `base_dn` (R8). Role mapping is in `config/infra/sso-eldap.yaml` `role_mappings`.
- `POST /api/auth/sso/login` (~line 1047) sets cookies `sentinel_session` (httpOnly, SameSite=Strict, 8 h) and `sentinel_csrf`. `POST /api/auth/logout` (~line 1101) revokes the token. `/api/auth/me` (~line 1112) duplicates the role-entitlement lookup instead of calling `access_policy`.
- The frontend never calls `/api/auth/sso/login`. `App.jsx` (~line 225) calls `/api/auth/me` once and shows "Signing in…" forever on 401. "Lock Session" (`App.jsx` ~line 802) only calls `alert()`.
- `frontend/src/api.js` `apiFetch` adds the CSRF header for mutating requests.
- Alerts (`database/db.js` `addAlert`, ~line 794) store `timestamp` / `last_seen` but no source-event time, so detection latency cannot be measured today.
- CORS is configured at `backend/server.js` ~lines 121-139 with `cors_validator.js`. Chrome sends `Origin` on the page's own module script and stylesheet requests, so an unlisted own address gets 500 on `/assets/*.js` and the page is blank.
- The CSP (`backend/server.js` ~lines 88-96) allows `https://fonts.googleapis.com` and `https://fonts.gstatic.com`. `frontend/src/App.css` line 1 imports Google Fonts.

---

## 5. Work packages: AUTH (Wave 1)

**Follow the companion plan's Tasks 1, 2 and 3 exactly, including its test code.** Summary of what must be true when done:

### N1. Per-user environments
- `access_policy.js` exports `environmentsFromGroups(memberOf: string[]): string[] | null` (case-insensitive DN match against `security.environment_groups`; `null` when that map is empty or absent) and `defaultEnvironment(user, configured): string | null`.
- `allowedEnvironments(user)` rule order: no user → all; `Super Admin` → all; `user.environments` is an array → that list limited to `prod`/`staging`; else the existing role rule.
- `session.generateToken` adds an `environments` claim only when `user.environments` is an array.
- `config/global.yaml` `security:` gets `environment_groups: {}` with these commented examples:
  ```yaml
  # environment_groups:
  #   "cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp": [prod]
  #   "cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp": [staging]
  ```
- Test: `tests/env_access.test.js` (unit section).

### N2. Real eLDAP sign-in (includes R7, R8)
- Real bind when `NODE_ENV=production` **or** `SENTINEL_AUTH_MODE=ldap`. Default behaviour otherwise unchanged (existing 91 tests must still pass).
- Search base `search_base || base_dn || 'dc=enterprise,dc=corp'` (R8). Optional `sso_ldap_config.tls_ca_file` → `tlsOptions.ca`.
- Result codes: `BAD_CREDENTIALS` (wrong password **and** unknown user, both with the text `Invalid LDAP credentials or bind failed.`), `NO_ACCESS` (no mapped role group, R7: `Your account is not in a Sentinel access group.`; or no environment group: `Your account has no Sentinel environment access (groups: sentinel-env-prod / sentinel-env-staging).`), `UNAVAILABLE` (`Sign-in service unavailable. Try again or contact the Sentinel admins.`).
- The returned user is `{ username (sAMAccountName, lower case), role, email, environments?, authenticatedVia }`. `memberOf` and `dn` are not returned.
- New staging test users: `stg_operator` (NOC Operator, `['staging']`), `prod_operator` (NOC Operator, `['prod']`).
- New fixture `tests/fixtures/ldap_test_directory.js` using `ldap.createServer()` on 127.0.0.1 port 0; new test `tests/ldap_bind.test.js`.

### N3. Routes and session issuer
- New `backend/auth/issue_session.js`: `issueSession(res, user) -> { token, csrfToken }`, which sets both cookies exactly as the login route does today. Used by login and `/api/environment`.
- Login: 400 missing fields, 401 `BAD_CREDENTIALS`, 403 `NO_ACCESS`, 503 `UNAVAILABLE`. On success `user.environment = defaultEnvironment(user, config.ENVIRONMENT)`, and the response is `{ authenticated, token, csrfToken, user: { username, role, email, environment, allowedEnvironments } }`.
- `/api/auth/me` returns `allowedEnvironments: accessPolicy.allowedEnvironments(user)`.
- WebSocket handler: when `allowedEnvironments(wsUser)` is empty, close with code 1008 and do not fall back to `staging`.
- Tests: `tests/env_access.test.js` (http section) proves a STG-only and a PROD-only user can be signed in at the same time, each refused the other environment.

**server.js regions AUTH may edit:** the `/api/environment` route, the `/api/auth/sso/login` route, the `/api/auth/me` route, and the WebSocket connection handler. Nothing else.

**Done when:** `node tests/env_access.test.js && node tests/ldap_bind.test.js && node tests/ldap_client.test.js && node tests/auth_lockdown.test.js && node tests/prod_login_lockdown.test.js && node tests/security_fixes.test.js` all pass, and `npm test` passes.

---

## 6. Work packages: API (Wave 1)

### R2. Alert Detection Latency SLO from data, or UNKNOWN
- **File:** `backend/services/slo/slo_tracker.js` lines ~54-59 (the `alert_detection_latency` branch).
- **Change:** remove the fixed values 98.4 / 85.0 / 0.4 / HEALTHY. Alerts have no source-event time (section 4), so leave `current_sli`, `error_budget_remaining_percent` and `burn_rate` as `null` and `status` `'UNKNOWN'` unless an alert carries both `event_time` and `timestamp`. When at least one does: SLI = percentage of those alerts where `timestamp - event_time <= target_p95_seconds` (30 s), rounded to 2 decimals. Error budget and burn rate use the same formulas as the `autonomous_recovery_success_rate` branch above it, and status uses the same thresholds.
- **Test:** `tests/slo_alert_latency.test.js`:
  - no alerts → `status === 'UNKNOWN'` and `current_sli === null`;
  - 5 alerts without `event_time` → UNKNOWN;
  - 10 alerts with `event_time`, 9 detected within 30 s and 1 after 120 s → `current_sli === 90` and status not `HEALTHY` (target 95).
  - Also grep the repo for other hard-coded SLI or health numbers in `backend/services/**` and list any you find in your report (do not change them).

### R3. CORS accepts the app's own address and refuses with 403
- **Files:** `backend/server.js` CORS block (~lines 121-139), `backend/cors_validator.js`.
- **Change:**
  - Switch to the per-request form `app.use(cors((req, cb) => …))`.
  - Allow when `Origin` equals the request's own origin `${req.protocol}://${req.get('host')}`. `trust proxy` is already set, so `req.protocol` honours `X-Forwarded-Proto` behind IIS.
  - Otherwise keep the existing allowlist rule unchanged.
  - Send a refused origin to an error handler that answers `403 {"error":"Origin not allowed"}` instead of 500.
- **Test:** `tests/cors_same_origin.test.js`:
  - server on port P, `GET /assets/<real bundle name from frontend/dist/index.html>` with `Origin: http://127.0.0.1:P` → 200;
  - `GET /api/health` with `Origin: https://evil.example` → 403, and no `Access-Control-Allow-Origin: https://evil.example` header;
  - `GET /api/health` with `ALLOWED_ORIGIN` set to `https://sentinel.test` and that origin → 200 with `Access-Control-Allow-Origin: https://sentinel.test`.
- `tests/phase_s_security.test.js` and any other existing CORS assertions must still pass. If one asserted status 500, update it to 403 and say so in the commit message.

### R6. Recovery trigger refuses unknown components
- **File:** `backend/server.js` `POST /api/recovery/trigger` (~line 2017).
- **Change:** when `recovery.triggerRecovery(...)` returns `null`, answer `404 {"success":false,"error":"No recovery workflow for <component>"}` and still write the audit entry with `outcome: 'NO_WORKFLOW'`.
- **Test:** add to `tests/recovery_four_eyes.test.js`: trigger `does_not_exist` as SRE Lead → 404 and the error text; trigger `artifactory` → 200 and `run.status === 'Awaiting-Approval'`.

**server.js regions API may edit:** the CORS block and the recovery-trigger route. Nothing else.

**Done when:** the three tests above pass, and `npm test` and `npm run lint` pass.

---

## 7. Work packages: UI, DOCS, QA

### WP-UI-1 (Wave 1): R4, R5, R9

**R4. SLO cards readable in both themes.** In `frontend/src/components/sre/SloErrorBudget.jsx` and its CSS (`slo-dashboard-container`, `slo-header-banner` and the card classes), replace hard-coded dark backgrounds with the app's theme variables, so card text and background come from the same theme. **Check:** at 1440×900 in the light and the dark theme, every text element inside `.slo-dashboard-container` has a contrast ratio ≥ 4.5:1 (use the contrast function from section 9).

**R5. Badge on the right menu item.** In `App.jsx` (~line 661) show the `pendingApprovals` badge on the `remediation` item instead of `problems`, with `title="Recovery runs waiting for approval"`.

**R9. Minor UI items.**
- **(a) Contrast.** Raise to ≥ 4.5:1 in the light theme:
  - the maintenance banner text (`MaintenanceNotice.css`, measured at 1.35:1);
  - the "Find Asset" button (2.49:1);
  - `.uptime-badge` (`App.css` ~line 2732, 3.04:1);
  - `.env-chip.active-stg` (`App.css` ~line 2538, 3.19:1).
  - Keep the hue; darken the text.
- **(b) No Google Fonts.**
  - Remove the `@import` on `App.css` line 1.
  - Set the font tokens to local stacks: body `"Segoe UI", system-ui, -apple-system, Arial, sans-serif`, mono `Consolas, "Cascadia Mono", ui-monospace, monospace`.
  - The CSP change in `backend/server.js` (drop the two Google hosts) belongs to API's file region. Report it to ORCH, who applies it at merge time.
- **(c) Phone sidebar.** `sidebarOpen` (`App.jsx` ~line 216) starts `false` when `window.innerWidth < 900`.
- **(d) Viewer buttons.**
  - Add `frontend/src/roles.js` exporting `canOperate(role)`, true for Super Admin, SRE Lead and Operator. Ignore NOC Operator for now.
  - Also export `canAdminister(role)`, true for Super Admin and SRE Lead.
  - Disable these buttons when the current user lacks the role, with `title="Needs SRE Lead or Super Admin"`:
    - "Enable Autonomous Mode" (Remediation view);
    - recovery approve buttons;
    - rota "Upload Excel Table" and "Add Shift Row";
    - "Create change window".
  - Do not hide them.
- **(e) Stale rota warning.** In the On-Call view, when the first row's date is not in the current month, show above the table: `This rota is for <Month YYYY>. Upload the current month's rota.`

**Done when:** `npm run build`, `npm run verify:dist`, `npm run lint` and `node tests/ui_smoke.test.js` pass, and REVIEW has seen before/after screenshots of the SLO page (both themes), the header, and the On-Call page.

### WP-UI-2 (Wave 2): N4 and R1

**N4.** Follow the companion plan's Task 4 exactly. The key contract:
- `frontend/src/auth.js` exports `fetchMe`, `signIn`, `signOut`, `AUTH_REQUIRED_EVENT = 'sentinel:auth-required'`.
- `LoginPage` has inputs `#login-username` and `#login-password` and the button "Sign in". Errors go in a `role="alert"` element.
- `App.jsx` has states `checking` / `signed-out` / `signed-in`. Signed out renders only the login page and opens no WebSocket.
- "Lock Session" becomes "Sign out".
- Environment chips are limited to `currentUser.allowedEnvironments`.
- Any later 401 shows the login page with `Your session ended. Sign in again.`
- Update `tests/ui_smoke.test.js` to sign in as `admin_sentinel` before its first test (the gate would otherwise block it).

**R1. No false "healthy".** When a dashboard data request fails (non-2xx other than 401, or a network error):
- the Scorecard tiles show `—` with the caption `Data unavailable`, not `0` or "All layers operating within baseline";
- the header badge "LIVE NOC ENGINE" becomes `OFFLINE` (red) whenever the WebSocket is not connected.

Apply the tile rule wherever the Scorecard and Problems views turn a failed fetch into an empty list. Find these by searching their fetch calls for `catch` and `!res.ok` branches that set `[]` or `0`.

**R1 test:** add to `tests/ui_login.test.js` or a new `tests/ui_data_unavailable.test.js`. Sign in, then `page.route('**/api/problems**', r => r.fulfill({ status: 500, body: '{}' }))`. Reload. Expect the text `Data unavailable`, and no `All layers operating within baseline`.

**Done when:** `npm run build`, `verify:dist`, `lint`, `node tests/ui_smoke.test.js` and the R1 test pass.

### WP-DOCS (Wave 2): N6
Follow the companion plan's Task 6. Add `SENTINEL_AUTH_MODE` to `.env.example` with the comment `# ldap = real eLDAP sign-in outside production (staging host). Unset = test users.` The section in `docs/PRODUCTION_READINESS_PLAN.md` must name:
- the six AD groups: four role groups from `config/infra/sso-eldap.yaml`, plus `sentinel-env-prod` and `sentinel-env-staging`;
- the `environment_groups` block;
- `base_dn` and `tls_ca_file`;
- the CyberArk object `ELDAP-BIND-SVC`, or `SSO_ELDAP_BIND` on staging;
- on the staging host, `SENTINEL_AUTH_MODE=ldap` and `security.require_auth_for_reads: true`;
- that `ALLOWED_ORIGIN` must list every address users open.

### WP-QA (Wave 3): N5 and independent verification
- Write `tests/ui_login.test.js` from the companion plan's Task 5 (7 scenarios), and add it to `test:all`.
- Then run section 9 in full on a fresh clone of `main` (not on an agent's working copy), and write the report.

---

## 8. When to stop and ask ORCH

Stop and report instead of guessing when:
- a test in the existing 91 fails, and the fix is outside your files;
- you need to change a file another agent owns (state the exact change);
- the code differs from section 4 by more than a few lines (for example a route moved, or a function was renamed);
- a change would weaken any of SF-06 to SF-18 (startup guard, four-eyes, settings allowlist, LDAP escaping, evidence env binding, session cap/revocation/logout, WebSocket log filtering, git symlink refusal, role gates);
- you would need real credentials, a live directory, or network access.

## 9. Final verification (ORCH, then QA independently)

```bash
git clone <repo> verify && cd verify && npm ci && npm run setup && node scripts/bootstrap.js
npm run lint
npm run verify:dist
npm test                        # expect: [run_tests] 96 test file(s) passed (97 if R1's test is a separate file)
```
Expected test count: 91 existing + 5 new (`env_access`, `ldap_bind`, `slo_alert_latency`, `cors_same_origin`, `ui_login`) = 96, plus `ui_data_unavailable` if R1's test is its own file = 97. R6 adds cases to the existing `recovery_four_eyes.test.js`. Write the number you actually get, and list the files.

**Manual checks on a staging-mode server.** Run `SENTINEL_AUTH_MODE` unset, `ALLOWED_ORIGIN=http://127.0.0.1:3320`, `PORT=3320`, then:
1. `/` shows the login page. A wrong password shows the error.
2. `stg_operator` sees only STAG. `prod_operator` sees only PROD. Both are signed in at once in two browser contexts.
3. Sign out returns to the login page. Pressing back does not show data.
4. SLO page is readable in both themes. Alert Detection Latency shows UNKNOWN.
5. Opening the site at `http://localhost:3320` (not in `ALLOWED_ORIGIN`) still loads the UI.
6. Startup guard: `HOST=0.0.0.0` without `NODE_ENV=production` still refuses to start.

**Contrast check** for R4 and R9a, in Playwright `page.evaluate`: compute the WCAG ratio between an element's computed `color` and the first ancestor with a non-transparent `background-color`. Report every text element under 4.5:1 on the Scorecard and SLO pages.

## 10. Report format (each agent, then ORCH's final report)

```
Work package: WP-xxx        Branch: wp/xxx        Commits: <hash> <subject> (one line each)
Items:  R2 DONE | R3 DONE | R6 DONE   (or BLOCKED: <reason>)
Tests:  <command> -> <pass/fail counts>
Files changed: <path> (+added/-removed lines)
Deviations from this work order: <none | what and why>
Questions for ORCH: <none | list>
```
ORCH's final report adds:
- the section 9 results, with the actual test count;
- screenshots for manual checks 1, 2, 4 and 5;
- the list of hard-coded values found by the R2 grep;
- any item not done, and why.