# Production Implementation Plan

How to get Project Sentinel from a local clone to a production service, in two stages.

**Stage 1** puts the shell in production on demo data — days of work, low risk, real value.
**Stage 2** onboards the real estate one application at a time — the Jira backlog.

Companion documents: [`CODEBASE_MAP.md`](./CODEBASE_MAP.md) for what each file does, [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md) for the engineering specification, [`PROGRESS.md`](./PROGRESS.md) for current state.

---

## 0. Run it locally first

### Developer machine (has a registry, wants hot reload)

```bash
git clone <repo> && cd sentinel-webdesign
npm install          # installs workspaces and creates the @sentinel/* symlinks
npm run launch       # bootstrap (generates .env), build, start
```

### Production / restricted host (no public npm)

Target hosts cannot reach `registry.npmjs.org`, so installs route through the
internal Artifactory npm remote. That also keeps every package flowing through
Nexus IQ, which is where OSS vulnerability and licence policy is enforced --
committing `node_modules` would bypass it.

```bash
cp .npmrc.example .npmrc     # then set your real Artifactory host
npm ci --omit=dev            # 13 packages, all pure JS, ~11 MB
npm run serve                # bootstrap, verify dist, start -- no build step
```

`frontend/dist` is **committed**, so the host never needs Vite or any dev
dependency. The trade-off is staleness: someone edits `frontend/src`, forgets to
rebuild, and ships an old bundle. `npm run build` records a fingerprint of the
sources next to the bundle and `npm run verify:dist` fails if they have diverged.
`npm run serve` runs that check before starting, and it is CRLF-safe so a
Windows checkout does not read as a change.

**Rebuild and commit `frontend/dist` whenever you change frontend code.**
Add `npm run verify:dist` to CI.

Open `http://localhost:3001`. Dev mode with hot reload is `npm run dev` → `http://localhost:5173`.

It runs with **no database**. Metrics, logs and events stay in memory, identity uses a local dev store, and history does not survive a restart. To attach one:

```bash
docker compose -f tools/validation/docker-compose.validation.yml up -d
npm run migrate
```

**Checklist**

- [ ] `npm install` completes, `node_modules/@sentinel/` contains 9 symlinks
- [ ] `.npmrc` points at the internal Artifactory remote (production hosts)
- [ ] `npm ci --omit=dev` succeeds without reaching public npm
- [ ] `npm audit --omit=dev` reports 0 vulnerabilities
- [ ] `npm run verify:dist` passes (committed bundle matches source)
- [ ] `npm run launch` serves `http://localhost:3001`
- [ ] `npm test` green
- [ ] `npm run preflight` runs (all targets unreachable is the correct result with placeholder config)
- [ ] `npm run dev` serves `http://localhost:5173` with hot reload

---

# Stage 1 — Ship the shell on demo data

## What this is, and is not

**Is:** a working UI on synthesized data, deployed on real infrastructure, behind real authentication. It proves the hosting path — IIS, AVI, TLS, LDAP, RefWeb routing — which is the part you cannot test locally and the part that will surprise you.

**Is not:** a monitoring tool. It must not appear in any incident runbook, bridge-call procedure, or CMDB entry as a monitoring service.

**The failure to design against:** an engineer opens Sentinel at 03:00, sees green tiles, and stands down — on demo data. Everything below exists to make that impossible.

## Why the risk profile is genuinely lower

A demo-only deployment holds **no production credentials** (no CyberArk binding), runs **no collectors** (never reaches your estate), and stores **no real telemetry** (so backup, DR and retention are not go-live gates). Most Tier-1 objections apply to a system carrying real data. They do not apply to a shell.

## S1.1 — Pre-deployment gates

- [ ] `config/global.yaml` → `environment: "demo"`
- [ ] `applications_enabled:` → **all false**
- [ ] `components_enabled:` → **all false**
- [ ] `collectors.dynatrace.enabled: false`, `collectors.python_metrics.enabled: false`
- [ ] `config/cyberark.yaml` → **no production safes mapped**
- [ ] `prod_urls.db_jdbc: ""` and `stg_urls.db_jdbc: ""` — **blank, not just disabled**
- [ ] `ALLOWED_ORIGIN` set to the real corporate URL
- [ ] `config/ui.yaml` → `showGlobalBanner: true`, `globalNote` reading **"DEMONSTRATION DATA — NOT LIVE TELEMETRY"** (applies on refresh, no rebuild)
- [ ] `SENTINEL_JWT_SECRET` set as a **machine environment variable**, not in `.env`
- [ ] Branch pushed to the remote

### Why blanking URLs beats disabling features

The `applications_enabled` and `components_enabled` toggles gate **collectors**. They do not gate **infrastructure clients** — the database pool, CyberArk, Snowflake. Those are constructed from their URL alone.

Measured on a 25-second boot with `environment: demo` and every toggle set to false:

| Config | Outbound attempts | Host reached |
|---|---|---|
| Toggles off, `db_jdbc` still set | **15** | `db-stg-primary.internal.corp` |
| Toggles off, `db_jdbc: ""` | **0** | none |

The pool is built straight from `db_jdbc` with nothing consulting a toggle, and the log and event stores attempt a write on every tick. A "demo-only" host would sit hammering the staging database — visible in DB audit logs, and quite possibly tripping a security alert from a host nobody expected to see connecting. Note it reaches *staging* while set to demo, because `ACTIVE_URLS` routes everything that is not `prod` to the staging URL set.

**The rule: if an endpoint is not configured, nothing can reach it.** Blank the URL rather than disabling the feature that uses it. It is also more durable — someone re-enables a toggle months later and nothing happens, because there is no endpoint to hit.

> The bootstrap script refuses to generate a JWT secret when `NODE_ENV=production`. That is deliberate — a generated secret would invalidate every session on restart and hide a deployment error.

## S1.2 — Host setup (Windows Server)

- [ ] Node 24.x installed and on `PATH`
- [ ] IIS with **HttpPlatformHandler** installed
- [ ] Application pool created, identity assigned
- [ ] Repository deployed to the target path
- [ ] `cp .npmrc.example .npmrc` and set the Artifactory host
- [ ] `npm ci --omit=dev` (no build toolchain needed — `frontend/dist` is committed)
- [ ] `npm run verify:dist` passes
- [ ] `web.config` in place; set `stdoutLogEnabled="true"` so the audit stream reaches SIEM
- [ ] `install_service.ps1` run, service starts on boot
- [ ] Log directory writable; rotation confirmed

## S1.3 — Network and identity

- [ ] TLS certificate issued for the corporate URL, expiry recorded
- [ ] AVI virtual service configured; health monitor on `/healthz` expecting 200
- [ ] WebSocket upgrade passes through AVI and IIS (verify `/ws` returns 101)
- [ ] `sso_ldap_config.ldap_url` set to the real `ldaps://` URL — **not** the OAuth endpoint
- [ ] Service account for the LDAP bind created and vaulted
- [ ] Group→role mapping confirmed in `config/infra/sso-eldap.yaml`
- [ ] Firewall: browsers → AVI → host on 443 only

## S1.4 — Post-deployment verification

Run against the deployed URL, not localhost:

- [ ] `/healthz` returns 200
- [ ] SPA loads; browser console clean
- [ ] Login succeeds with a **real directory account**
- [ ] Login **fails** with a bad password (this is the auth-bypass regression test)
- [ ] Each role sees the right things; a Viewer cannot approve a recovery
- [ ] Demo banner visible on every view
- [ ] Every tab renders without error
- [ ] Switching to PROD shows **DATA_UNAVAILABLE**, not fabricated values
- [ ] Two browser sessions hold different environments simultaneously
- [ ] Service survives a host reboot

## S1.5 — Organisational guardrails

- [ ] Named application owner and technical owner recorded
- [ ] Announcement states explicitly: **demonstration only, not a monitoring source**
- [ ] **Not** added to any incident runbook or escalation procedure
- [ ] CMDB entry, if any, classified **Pilot** — not Tier-1
- [ ] Review date set for the Stage 2 decision

---

# Stage 2 — Onboard the estate

Each application is one epic. Do **Jenkins first**: it is the most complex topology you have (5 Operations Centers, 10 controllers, 250 agents, 4 build clusters). If the model survives Jenkins, the other twelve are variations. If it does not, you want to learn that on epic one.

## The per-application template

**Epic: Onboard `<tool>`**

| # | Task | Done when |
|---|---|---|
| 1 | Record real endpoints in `config/apps/<tool>.yaml` | `npm run preflight` reaches the host |
| 2 | Request a **read-only** service account | Account exists, scoped, documented |
| 3 | Vault the credential; map it in `config/cyberark.yaml` | `credential_provider` resolves it |
| 4 | Set the `auth:` block (bearer / basic / mTLS / cookie) | Preflight reports **REACHABLE**, not AUTH_FAILED |
| 5 | Declare topology — nodes, agent pools with `expected_count`, regions | `/api/v2/entities` returns the fleet |
| 6 | Rewrite the collector to parse the real response | No value comes from `metrics_baseline` |
| 7 | Add the tool's log patterns | Fingerprints generated |
| 8 | Set `jenkins_remediation_job`, scoped to named jobs only | Runbook resolves |
| 9 | Restore `db_jdbc` and enable `applications_enabled.<tool>: true` | Tiles show real values |
| 10 | Verify prod shows real data and demo still shows demo | Both correct |

> **Collection covers both environments automatically.** The coordinator always
> iterates `['staging', 'prod']` on its timer, setting `global.collectorEnvironment`
> per pass so each resolves its own URL set. Enabling a tool's toggle starts
> collection for that tool in **both** environments — there is no separate switch,
> and the UI environment selector has no effect on it. Verified: with toggles on,
> 28 components collected for prod and 27 for staging in a single 22-second run.

**Suggested order:** Jenkins → Artifactory → Bitbucket → SonarQube → TeamCity → Nexus IQ → Fortify → ArgoCD → Argo Workflows → GitHub → Aquasec → OTKR → Performance Center.

Infrastructure layers (AVI, k8s, NFS/Trident, Windows, Linux, SSO) are their own epic and should land **early** — the correlation engine blames infrastructure, and it cannot do that without real infrastructure data.

## Parallel epics

**Agent rollout.** Fluent Bit and OTel collectors via your existing config-management channel (SCCM / Ansible Tower). Sentinel renders configs; it never pushes them. Include agent heartbeat — a silent shipper looks exactly like a healthy application.

**View consolidation.** 17 tabs today, 8 after merging. `rca` and `timeline` render the identical component. Candidates: blast-radius + timeline + RcaDashboard → one Root Cause workspace; matrix → health; entities → fleet; pbi → metrics; ailogs → logs; misc → admin.

**Code quality.** Resolve the 4 `lint:constants` violations (2 genuine, 2 false positives from the rule's case-insensitive flag). Correct the stale claims in `ARCHITECTURE.md` and `PRODUCTION_GUIDE.md`.

## The trigger that changes everything

**The moment the first real application is onboarded, Sentinel stops being a demo.** People begin to trust it, and every Tier-1 obligation activates. Start these when epic one begins, not when it ends — they have long lead times.

### Track B — assurance
- [ ] Independent penetration test **booked** (weeks of queue time)
- [ ] SAST in CI — you already own Fortify
- [ ] DAST against the running instance
- [ ] SCA / `npm audit` as a build gate
- [ ] Threat model and security architecture sign-off
- [ ] Secrets scan across the repo **and its history**
- [ ] Open-source licence review

### Track C — operational acceptance
- [ ] Backup and **tested restore**; RPO/RTO agreed
- [ ] DR posture — what happens to Sentinel *during* a DR event
- [ ] Capacity model: disk growth/day at 2,000 hosts, IOPS, pool sizing
- [ ] Failure-mode testing and a graceful-degradation matrix
- [ ] **CI/CD pipeline for Sentinel itself** — none exists today
- [ ] Branch protection; no direct commits to `main`
- [ ] SBOM, artifact signing, release tagging, documented rollback
- [ ] dev → SIT → UAT → prod promotion path
- [ ] Runbook and operations manual
- [ ] L1/L2/L3 support model and an on-call rota **for Sentinel itself**
- [ ] CMDB reclassification to Tier-1, SLA/OLA
- [ ] NOC operator training
- [ ] Data classification and DPIA
- [ ] Retention schedule mapped to policy
- [ ] RBAC matrix signed off; SoD analysis on four-eyes
- [ ] Self-observability exported **elsewhere**
- [ ] **External dead-man's switch** — a monitoring platform that fails silently is worse than none

### Autonomous remediation — graduated, not granted
1. Default off; manual trigger only
2. Each runbook individually pre-approved as a SOX standard change
3. Stays manual until ~20 clean executions under four-eyes
4. Autonomy enabled **per runbook**, never globally
5. Every execution raises a CHG record
6. A kill switch that halts all autonomous execution without a deploy

---

## Honest timeline

| Stage | Effort |
|---|---|
| Stage 1 (demo shell in production) | **Days** |
| First application end to end | **1–2 weeks** — mostly waiting on accounts and access |
| Remaining twelve | Weeks each, parallelisable |
| Track B | Weeks of queue time — book now |
| Track C | **Usually sets the go-live date** |

Track C is your critical path to Tier-1, not code.

---

## Rollback

**Stage 1:** stop the service, remove the AVI pool member. No data to unwind.

**Stage 2, per application:** set `applications_enabled.<tool>: false` and restart. The collector stops, tiles return to DATA_UNAVAILABLE, nothing else is affected. This is why per-application onboarding is the right shape — each epic is independently reversible.

---

# Exact edits — every file and line to change

Line numbers are against the tree at the time of writing. Run `npm run config:check`
after any edit; it validates and prints what each application will do.

## `config/global.yaml` — the primary file

### Environment and profile

| Line | Setting | Demo shell | Production |
|---|---|---|---|
| **14** | `environment:` | `"demo"` | `"prod"` |
| **18** | `telemetry_provider:` | leave | `"opentelemetry"` (Profile 1) |

> `environment` accepts `prod`, `staging` or `demo`. `production`, `prd`, `stg` and
> `stage` are normalised in `backend/config/config.js`; anything else falls back to
> `staging` with a warning. The rest of the system speaks only the three canonical
> tokens — this normalisation is what closed the production authentication bypass.

### `prod_urls:` — block starts line 21

| Line | Key | What to set |
|---|---|---|
| **22** | `app_url` | Your Sentinel domain URL |
| **23** | `avi_virtual_service_url` | Your AVI VIP |
| **24** | `bitbucket_api` | Bitbucket REST base |
| **25** | `artifactory_api` | Artifactory API base |
| **26** | `argocd_api` | ArgoCD API base |
| **27** | `argoworkflows_api` | Argo Workflows API base |
| **28** | `jenkins_master_url` | Jenkins / CJOC job root |
| **29** | `teamcity_api` | TeamCity `/app/rest` |
| **30** | `sonarqube_api` | SonarQube API base |
| **31** | `nexusiq_api` | Nexus IQ API base |
| **32** | `fortify_api` | Fortify SSC API base |
| **33** | `avi_api` | AVI telemetry API |
| **34** | `sso_api` | SSO / OAuth token endpoint |
| **35** | `nas_mount` | UNC or local path for log archives |
| **36** | `windows_api` | Windows fleet metrics endpoint |
| **37** | `unix_api` | Linux fleet metrics endpoint |
| **38** | `db_jdbc` | **`""` for the demo shell.** TimescaleDB JDBC URL for production |
| **39** | `k8s_api` | Kubernetes API server |
| **40** | `s3_endpoint` | S3 endpoint for log archival |
| **41** | `github_api` | GitHub Enterprise API |
| **42** | `bitbucket_external_api` | External Bitbucket |
| **43** | `otkr_api` | OTKR |
| **44** | `performance_center_api` | Performance Center |
| **45+** | `network_latency_hosts` | Hosts to ping for latency |

### `sso_ldap_config:` — block starts line 52

| Line | Key | Note |
|---|---|---|
| **55** | `ldap_url` | **Must be `ldaps://host:636`.** Not the OAuth URL — `ldap_client.js` reads this key, and pointing it at an HTTPS endpoint fails the bind with an unhelpful protocol error |
| **56** | `base_dn` | User search base |
| **57** | `group_base_dn` | Group search base |
| **58** | `bind_dn` | Service account DN; its password comes from CyberArk, never this file |
| **59** | `sso_issuer` | OIDC issuer, if used |

Role mapping lives in `config/infra/sso-eldap.yaml` under `role_mappings`.

### `stg_urls:` — block starts line 67

Same keys as `prod_urls`. Notable lines: **68** `app_url`, **69** `avi_virtual_service_url`, **71** `db_jdbc` (**blank for the demo shell**), **72** `nas_mount`.

> Anything that is not `prod` resolves to `stg_urls` — including `demo`. Demo has no
> URL set of its own, which is why blanking `stg_urls.db_jdbc` matters for a demo
> deployment.

### Toggles

| Line | Block | Demo shell | Production |
|---|---|---|---|
| **107** | `collectors:` | `dynatrace.enabled: false`, `python_metrics.enabled: false` | per requirement |
| **122** | `components_enabled:` | **all false** | enable provisioned layers only |
| **139** | `applications_enabled:` | **all false** | enable onboarded apps only |

`applications_enabled` is an **operator override**. Omit an app and its own manifest
`enabled:` decides — which is why adding an application needs only one file.

## Other config files

| File | What to change |
|---|---|
| `config/telemetry.yaml:11` | `selected_profile:` — `1` OTel, `2` Dynatrace, `3` Prometheus |
| `config/cyberark.yaml:4+` | Map each app to its Safe and Object names. **Leave empty for the demo shell** |
| `config/ui.yaml:13` | `globalNote` — the banner. Applies on browser refresh, no rebuild |
| `config/ui.yaml:12` | `showGlobalBanner` |
| `config/.env` | `PORT`, `ALLOWED_ORIGIN`, `NODE_ENV` |
| `config/apps/<tool>.yaml` | Per-application endpoints, auth, topology |
| `config/infra/sso-eldap.yaml` | LDAP group → role mapping |

## Source files that need a production edit

Almost nothing — configuration is YAML-first. These are the exceptions:

| File | Line | Change |
|---|---|---|
| `backend/server.js` | **51** | `trust proxy` — add your **AVI SNAT addresses**. Without this every request appears to come from one IP and the shared rate limiter throttles all users together |
| `web.config` | 15 | `stdoutLogEnabled` — keep `"true"`, this is the audit stream SIEM reads |
| `web.config` | 20 | `PORT` — leave as `%HTTP_PLATFORM_PORT%` under IIS |
| `web.config` | 21 | `NODE_ENV=production` — **required**, it enables the real LDAP bind |

**Do not edit `frontend/src/maintenanceConfig.js`.** It holds defaults only; live
values come from `config/ui.yaml`. Editing the source would require a rebuild.

## Environment variables — not in any file

| Variable | Where | Note |
|---|---|---|
| `SENTINEL_JWT_SECRET` | Machine environment variable | **Identical on both servers**, or sessions break on failover. Never in `.env` in production |
| `NODE_ENV` | `web.config:21` | Must be `production` |
| `PORT` | `config/.env` or `web.config` | |
| `ALLOWED_ORIGIN` | `config/.env` | Your domain URL |

## Verify

```bash
npm run config:check     # validates; prints enabled/endpoint per application
npm run verify:dist      # committed bundle matches source
npm run preflight        # reachable / auth-OK / unreachable per target
```

`preflight` is the one that proves the config-only promise: paste real values, run
it, and you get green or a precise per-target reason.
