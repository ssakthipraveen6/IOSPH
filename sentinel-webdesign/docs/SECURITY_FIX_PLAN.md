# Sentinel security fix and runtime patch plan

How to fix the ten issues from the 4 Nov 2026 security audit (quick profile, file REPORT.md) and patch the runtimes against the October 2026 Node.js and PHP security releases.
Line numbers are for the repository as of 4 Nov 2026; if a file has moved on, search for the quoted code.
Every task has an ID (SF-nn) that matches the Jira import file `docs/jira_security_fixes.csv`.

**Priority.** Blocker = fix before the next production release. High = within the sprint. Medium = next sprint.

## Runtime exposure (checked 4 Nov 2026)

| Runtime | Sentinel uses | Status | Fixed version |
|---|---|---|---|
| Node.js (servers) | 24.14.1 (.nvmrc) | **Affected** by the 21 Oct 2026 Node.js security release: 4 High, 4 Medium, 2 Low CVEs | 24.22.1 |
| Node.js (agent hosts) | any nodejs >= 18 (agent/packaging/nfpm.yaml) | **Affected** unless the host already has 22.23.4 / 24.22.1; 18 and 20 are end of life | 22.23.4 or 24.22.1 |
| Node.js (CI agent) | label nodejs-24, patch level not pinned | Check | 24.22.1 |
| PHP | not used (no PHP code, runtime or package) | **Sentinel not affected** by CVE-2026-109618 / 109619 | other hosts: 8.2.35, 8.3.36, 8.4.27, 8.5.12 |

## Order of work

1. Day 1: SF-01, SF-06, SF-07 (runtime patch and fail-closed start-up). They close the most serious exposure without code risk.
2. Days 2-4: S3 approval fixes (SF-08 to SF-11) with their tests, and SF-12 in the pipeline repository.
3. Next sprint: S5 and S6, then SF-17 (second audit on the deferred areas).
4. S8 closes each release: tests, readiness check, node-by-node deploy.

## Checklist

| ID | Priority | Epic | Task | Done |
|---|---|---|---|---|
| SF-01 | Blocker | S1 Patch runtimes (Node.js, PHP check) | Upgrade Node.js on both Sentinel servers to 24.22.1 | [ ] |
| SF-02 | High | S1 Patch runtimes (Node.js, PHP check) | Upgrade the CI build agent to Node.js 24.22.1 | [ ] |
| SF-03 | High | S1 Patch runtimes (Node.js, PHP check) | Raise the Node.js floor for the agent package on fleet hosts | [ ] |
| SF-04 | High | S1 Patch runtimes (Node.js, PHP check) | PHP: confirm not used by Sentinel; find and patch PHP elsewhere in the estate | [ ] |
| SF-05 | Medium | S1 Patch runtimes (Node.js, PHP check) | Audit npm dependencies on the release machine | [ ] |
| SF-06 | Blocker | S2 Fail closed when not configured for production | Refuse to start in an unsafe mode | [ ] |
| SF-07 | Blocker | S2 Fail closed when not configured for production | Set NODE_ENV in the scheduled-task install | [ ] |
| SF-08 | Blocker | S3 Four-eyes approval integrity | Stop the client from skipping approval on /api/recovery/trigger | [ ] |
| SF-09 | Blocker | S3 Four-eyes approval integrity | Allowlist the generic settings update | [ ] |
| SF-10 | Blocker | S3 Four-eyes approval integrity | Require dual approval for autonomous mode regardless of selected environment | [ ] |
| SF-11 | High | S3 Four-eyes approval integrity | Use the directory account name as the session identity | [ ] |
| SF-12 | High | S4 Deployment pipeline injection | Remove shell interpolation of TARGET_HOSTS in the deploy pipeline | [ ] |
| SF-13 | Medium | S5 Environment isolation and sessions | Bind the evidence pack to the caller environment | [ ] |
| SF-14 | Medium | S5 Environment isolation and sessions | Session lifetime cap, revocation and logout | [ ] |
| SF-15 | Medium | S5 Environment isolation and sessions | Send WebSocket log lines only to the matching environment | [ ] |
| SF-16 | Medium | S6 Synthetic git step | Refuse symlinks in the git canary write | [ ] |
| SF-17 | High | S7 Close the audit gaps | Run a standard-depth audit on the 15 deferred areas | [ ] |
| SF-18 | Medium | S7 Close the audit gaps | Quick role gates on unrestricted state-changing routes | [ ] |
| SF-19 | High | S8 Verify and release | Turn the audit validation plans into regression tests | [ ] |
| SF-20 | High | S8 Verify and release | Release, verify and update the readiness plan | [ ] |

## Task details

### S1. Patch runtimes (Node.js, PHP check)

#### SF-01 Upgrade Node.js on both Sentinel servers to 24.22.1

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `.nvmrc` | 1 | pins 24.14.1, which is inside the vulnerable range |
| `web.config` | 13 | IIS runs node.exe from PATH, so the machine install is what counts |
| `package.json` | 1 | no engines field; add one so old runtimes refuse to install |

**Steps**

1. Node.js 24.14.1 is affected by the 21 Oct 2026 Node.js security release (10 CVEs, 4 High: CVE-2026-111497 Brotli out-of-bounds write, CVE-2026-105482 DNS NUL truncation, CVE-2026-105483 / CVE-2026-106069 TLS identity on IP endpoints). Fixed in v24.22.1. Bundled undici, OpenSSL, c-ares and CA certs are also updated.
2. Exposure in Sentinel: no code decodes Brotli (body-parser 1.20.8 inflates gzip/deflate only), but Sentinel makes many outbound HTTPS calls with fetch/undici and TLS to toolchain endpoints, so the TLS and DNS fixes apply.
3. Install the 24.22.1 MSI on node 2 first, restart, check health; then node 1. Set .nvmrc to 24.22.1 and add "engines": {"node": ">=24.22.1 <25"} to package.json.

**Sample**

```
node -v   # expect v24.22.1
.nvmrc: 24.22.1
"engines": { "node": ">=24.22.1 <25" }
```

**Done when:** Both nodes report v24.22.1; npm test passes; /api/healthz green through the VIP.

#### SF-02 Upgrade the CI build agent to Node.js 24.22.1

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `ci/Jenkinsfile` | 18 | AGENT_LABEL nodejs-24 does not pin a patch level |

**Steps**

1. Upgrade Node on every agent carrying the nodejs-24 label, or add a stage that fails when node -v is below 24.22.1.

**Sample**

```
sh 'node -e "const [a,b]=process.versions.node.split(\".\").map(Number); if(a<24||(a===24&&b<22)) process.exit(1)"'
```

**Done when:** A CI run prints v24.22.1 and the version gate stage passes.

#### SF-03 Raise the Node.js floor for the agent package on fleet hosts

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `agent/packaging/nfpm.yaml` | 18 | depends on nodejs (>= 18); 18 and 20 are end of life and unpatched |
| `agent/packaging/nfpm.yaml` | 21 | same for the RPM |
| `deployments/ansible/roles/sentinel_agent_linux/tasks/main.yml` | 28 | package install task |

**Steps**

1. Change both dependencies to nodejs (>= 22.23.4). 22.23.4 and 24.22.1 are the patched releases.
2. Add an Ansible pre-task that reports hosts with an older Node, and patch them before the agent wave.

**Sample**

```
- "nodejs (>= 22.23.4)"
```

**Done when:** Rebuilt packages refuse to install on old Node; fleet report shows no agent host below 22.23.4.

#### SF-04 PHP: confirm not used by Sentinel; find and patch PHP elsewhere in the estate

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/jobs/cve_scan.js` | 62 | Sentinel's own SBOM/CVE scan job can find PHP packages on monitored hosts |
| `config/global.yaml` | 219 | security.cve_scan settings (mirror_path, trivy_path) |

**Steps**

1. Sentinel contains no PHP (no .php files, no PHP runtime in packaging or deployment), so the PHP RCE flaws CVE-2026-109618 and CVE-2026-109619 (CVSS 9.2) do not affect Sentinel itself.
2. If any monitored host runs PHP (FPM, mod_php, php-cgi), patch it to 8.2.35, 8.3.36, 8.4.27 or 8.5.12, or the distribution backport. 8.1 and older have no official fix.
3. Use Sentinel to find them: refresh the Trivy offline mirror so it knows the two CVEs, run the CVE scan, then filter Security view by package php.

**Sample**

```
GET /api/v2/security/vulnerable-hosts?package=php&environment=prod
```

**Done when:** List of PHP hosts with version, each patched or with an owner ticket.

#### SF-05 Audit npm dependencies on the release machine

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `package-lock.json` | 1 | lockfile v3 pins the tree |
| `package.json` | 65 | ldapjs is decommissioned upstream |

**Steps**

1. Run npm audit --omit=dev on a machine with registry access; fix high/critical; plan replacing ldapjs.

**Sample**

```
npm audit --omit=dev --audit-level=high
```

**Done when:** No high or critical advisories open, or each one has an accepted exception.

### S2. Fail closed when not configured for production

#### SF-06 Refuse to start in an unsafe mode

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 2357 | HOST defaults to 0.0.0.0 |
| `backend/server.js` | 2380 | server.listen |
| `scripts/bootstrap.js` | 31 | IS_PROD only true when NODE_ENV=production |
| `scripts/bootstrap.js` | 58 | ensureSecret generates a dev secret instead of refusing |
| `backend/auth/ldap_client.js` | 221 | simulated login whenever NODE_ENV is not production |

**Steps**

1. Before listen: if HOST is not loopback and NODE_ENV is not production and SENTINEL_DEV is not true, log an error and exit 1.
2. In bootstrap: when config/global.yaml says environment: production but NODE_ENV is not production, refuse to generate a secret and exit 1.
3. Refuse SENTINEL_ALLOW_SIMULATED_LOGIN=true when config environment is production.

**Sample**

```
const loop = ['127.0.0.1','::1','localhost'].includes(HOST);
if (!loop && process.env.NODE_ENV !== 'production' && process.env.SENTINEL_DEV !== 'true') { console.error('[FATAL] Refusing to listen on ' + HOST + ' without NODE_ENV=production'); process.exit(1); }
```

**Done when:** Starting with NODE_ENV unset on 0.0.0.0 exits with the error; with NODE_ENV=production it starts; new test in tests/prod_login_lockdown.test.js.

#### SF-07 Set NODE_ENV in the scheduled-task install

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `install_service.ps1` | 56 | task action runs start.bat with no environment |
| `start.bat` | 67 | call npm run start |

**Steps**

1. In start.bat before npm run start: if not defined NODE_ENV set NODE_ENV=production.
2. In install_service.ps1 also set the Machine variable if it is missing, and print it.

**Sample**

```
if not defined NODE_ENV set NODE_ENV=production
call npm run start
```

**Done when:** After reboot the bootstrap log line shows NODE_ENV=production; npm run readiness shows PASS for NODE_ENV.

### S3. Four-eyes approval integrity

#### SF-08 Stop the client from skipping approval on /api/recovery/trigger

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 1987 | triggerOptions spreads req.body.options |
| `remediation/recovery.js` | 281 | isManualTrigger = !!options.manual |
| `remediation/recovery.js` | 299 | autonomousMode || isManualTrigger skips Awaiting-Approval |

**Steps**

1. Build triggerOptions from server values only: { manual: false, env: req.sentinelEnv, initiatedBy }.
2. Log options keys the client tried to send in the audit entry.
3. Add a regression test: options.manual=true from an Operator must give Awaiting-Approval.

**Sample**

```
const triggerOptions = { manual: false, env: req.sentinelEnv, initiatedBy };
```

**Done when:** Test passes; the run waits for two approvers.

#### SF-09 Allowlist the generic settings update

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 972 | db.updateSettings(req.body) |
| `database/db.js` | 532 | updateSettings does a shallow merge |

**Steps**

1. Accept only known UI keys in the generic branch; strip pendingApproval, autonomousMode, lastChangedBy, lastChangedAt.
2. Write pendingApproval only inside the four-eyes branch and add requestedAt plus an expiry (for example 4 hours).

**Sample**

```
const ALLOWED = ['theme','refreshInterval','notifications']; // extend with real UI keys
const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED.includes(k)));
const settings = db.updateSettings(patch);
```

**Done when:** Posting pendingApproval has no effect; regression test added.

#### SF-10 Require dual approval for autonomous mode regardless of selected environment

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 908 | dual approval only when env === 'prod' |
| `remediation/recovery.js` | 294 | reads the single global autonomousMode |

**Steps**

1. Either store autonomousMode per environment (settings.autonomousMode = {prod, staging}) and read the run env in triggerRecovery, or always require two signers when turning it on.
2. The per-environment option is safer and lets staging stay single-signer.

**Sample**

```
const auto = (db.getSettings().autonomousMode || {})[env] === true;
```

**Done when:** Turning it on with ?environment=staging leaves prod runs waiting for approval; test added.

#### SF-11 Use the directory account name as the session identity

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/auth/ldap_client.js` | 107 | filter built by interpolation |
| `backend/auth/ldap_client.js` | 166 | returns the typed username |
| `backend/auth/ldap_client.js` | 205 | denylist misses * ( ) |
| `remediation/recovery.js` | 349 | initiator check uses === |
| `remediation/recovery.js` | 365 | approval dedupe uses === |

**Steps**

1. Escape the username per RFC 4515 (\2a, \28, \29, \5c, \00) before building the filter; reject the login if more than one entry matches.
2. Return userEntry.sAMAccountName (lower-cased) as username.
3. Compare approvers case-insensitively on that canonical value.

**Sample**

```
const esc = s => s.replace(/[\\*()\x00]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2,'0'));
username: String(userEntry.sAMAccountName).toLowerCase(),
```

**Done when:** Signing in as JSMITH and jsmith gives the same username; a second approval by the same person is refused.

### S4. Deployment pipeline injection

#### SF-12 Remove shell interpolation of TARGET_HOSTS in the deploy pipeline

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/Jenkinsfile` | 109 | --limit "${params.TARGET_HOSTS}" in a Groovy GString |
| `deployments/Jenkinsfile` | 112 | token interpolated into the script text |
| `deployments/Jenkinsfile` | 25 | free-text parameter |

**Steps**

1. Switch the deploy sh to single quotes and reference "$TARGET_HOSTS" and "$SF_INFRA_OTEL_TOKEN" as environment variables.
2. Add a first stage that rejects TARGET_HOSTS unless it matches ^[A-Za-z0-9_.,:-]+$.
3. Quote ${TARGET_HOSTS} in the other stages too.

**Sample**

```
if (!(params.TARGET_HOSTS ==~ /^[A-Za-z0-9_.,:-]+$/)) { error('Invalid TARGET_HOSTS') }
sh '''ansible-playbook ... --limit "$TARGET_HOSTS" --extra-vars "otel_token=$SF_INFRA_OTEL_TOKEN"'''
```

**Done when:** A run with a $(...) value fails at validation; normal runs deploy.

### S5. Environment isolation and sessions

#### SF-13 Bind the evidence pack to the caller environment

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/routes/evidenceRoutes.js` | 260 | problemStore.get(id) by id only |
| `backend/routes/evidenceRoutes.js` | 272 | uses problem.environment |
| `backend/server.js` | 621 | sibling route already checks |

**Steps**

1. After loading: if problem.environment !== req.sentinelEnv return 404, same as the sibling route.
2. Do the same for attachments.

**Sample**

```
if ((problem.environment || 'staging') !== req.sentinelEnv) return res.status(404).json({ error: 'Not found' });
```

**Done when:** Staging-only role gets 404 for a prod problem; test added.

#### SF-14 Session lifetime cap, revocation and logout

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 454 | /api/environment re-mints tokens |
| `backend/auth/session.js` | 148 | generateToken sets a fresh exp |
| `backend/auth/session.js` | 158 | exp: now + ttlMs |

**Steps**

1. Add auth_time at login and carry it on refresh; reject tokens older than 12 hours from auth_time.
2. Revoke the old jti when /api/environment issues a new token.
3. Add POST /api/auth/logout that revokes the jti and clears cookies; add a Logout button.

**Sample**

```
if (payload.auth_time && Date.now() - payload.auth_time > MAX_SESSION_MS) return null;
```

**Done when:** Old token rejected after refresh; logout works; test added.

#### SF-15 Send WebSocket log lines only to the matching environment

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 312 | broadcast sends to every client |
| `backend/server.js` | 322 | global.broadcastLog |

**Steps**

1. Give broadcastLog an environment argument (from the log payload) and send only to clients whose ws.environment matches; drop untagged lines for non-admins.

**Sample**

```
global.broadcastLog = (line, env) => { for (const c of clients) if (c.readyState === 1 && (!env || c.environment === env)) c.send(JSON.stringify({ type: 'log', data: line })); };
```

**Done when:** A staging socket receives no PROD log frames; test added.

### S6. Synthetic git step

#### SF-16 Refuse symlinks in the git canary write

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `synthetics/steps/git.js` | 292 | clone arguments |
| `synthetics/steps/git.js` | 311 | writeFileSync follows symlinks |

**Steps**

1. Add -c core.symlinks=false to the clone arguments.
2. Before writing: lstat the target; if it is a symlink or its realpath is outside cloneDir, fail the step.
3. Restrict canary_file to a plain file name.

**Sample**

```
const target = path.join(cloneDir, name);
if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('canary path is a symlink');
```

**Done when:** Fixture repo with a symlink makes the step fail and leaves the target file unchanged.

### S7. Close the audit gaps

#### SF-17 Run a standard-depth audit on the 15 deferred areas

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 1 | events, correlation, preflight, entities, ws handshake, rota routes |
| `backend/routes/healthCheckRoutes.js` | 1 | run routes without role |
| `deployments/powershell/deploy_windows_telemetry.ps1` | 1 | MSI download without hash check |

**Steps**

1. Use the deferred list in the audit REPORT.md section 7 as the scope; standard profile; with a sandbox and installed dependencies so findings can be confirmed.

**Sample**

```
(process task)
```

**Done when:** Second audit report with no deferred units, or each deferred with a reason.

#### SF-18 Quick role gates on unrestricted state-changing routes

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/routes/healthCheckRoutes.js` | 1 | POST /:id/run and /run-all |
| `backend/routes/infraRoutes.js` | 234 | process dump |
| `backend/server.js` | 1804 | POST /api/v2/events |

**Steps**

1. Add requireRole(SRE_LEAD_PLUS) to health-check runs, process dump, events and correlation trigger; bind body environment to req.sentinelEnv.

**Sample**

```
router.post('/run-all', requireRole(SRE_LEAD_PLUS), async (req, res) => { ... })
```

**Done when:** Viewer gets 403 on each; tests added.

### S8. Verify and release

#### SF-19 Turn the audit validation plans into regression tests

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `tests/recovery_four_eyes.test.js` | 1 | extend for SF-08 to SF-11 |
| `tests/prod_login_lockdown.test.js` | 1 | extend for SF-06 |
| `package.json` | 37 | add new files to test:all |

**Steps**

1. Each fix ships with the local test described in NEEDS-VALIDATION.md for that lead; add them to test:all.

**Sample**

```
npm test
```

**Done when:** All new tests pass in CI.

#### SF-20 Release, verify and update the readiness plan

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `docs/PRODUCTION_READINESS_PLAN.md` | 1 | add the new checks |
| `scripts/prod_readiness_check.js` | 1 | add a Node version check |

**Steps**

1. Add a readiness row that fails when node -v is below 24.22.1.
2. Deploy to staging, run the full suite and npm run readiness, then prod node by node.

**Sample**

```
npm run build && npm test && npm run readiness
```

**Done when:** Prod runs the fixed code on Node 24.22.1; readiness shows no FAIL.

## Reference

### Sources for the runtime facts

- Node.js October 2026 security releases: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- PHP CVE-2026-109618 / CVE-2026-109619 fixed versions: https://redsift.com/blog/critical-php-vulnerabilities-cve-2026-109618-109619

### Audit leads covered by this plan

| Audit lead | Task |
|---|---|
| NODE_ENV unset fails open | SF-06, SF-07 |
| options.manual skips four-eyes | SF-08 |
| pendingApproval forgeable | SF-09 |
| Autonomous mode keyed on selected env | SF-10 |
| Uncanonical LDAP username | SF-11 |
| Jenkinsfile TARGET_HOSTS injection | SF-12 |
| Evidence pack cross-environment | SF-13 |
| Unbounded session refresh | SF-14 |
| WebSocket log broadcast | SF-15 |
| Git canary symlink | SF-16 |
