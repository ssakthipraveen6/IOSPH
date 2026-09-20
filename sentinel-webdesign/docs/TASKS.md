# Project Task List

Everything outstanding to call Project Sentinel complete, in one place.

- [`PROGRESS.md`](./PROGRESS.md) tracks the 73 engineering tasks from the remediation plan — most are done.
- **This file** is the remaining work: what is left in code, plus the process work that has not started.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) covers hosting. [`PRODUCTION_IMPLEMENTATION_PLAN.md`](./PRODUCTION_IMPLEMENTATION_PLAN.md) covers rollout.

Status legend: **`[ ]`** not started · **`[~]`** partial · **`[x]`** done

---

## Easy wins

Small, low-risk, and each removes a real problem. Start here.

| # | Task | Effort | Why it matters |
|---|---|---|---|
| E1 | **Push the branch** | 2 min | 13 commits exist only on one laptop. Largest single risk to the work. |
| E2 | Fix 2 genuine `lint:constants` violations | 30 min | `FleetExplorerView.jsx:264`, `HealthOverview.jsx:342` compare against `SEVERITY` values as string literals. Swap to the enum. |
| E3 | Drop the `/i` flag from the severity lint rule | 10 min | It matches lowercase UI tokens (`'warn'`, `'critical'`) that are not `SEVERITY` values, producing 2 false positives. Fixing E2+E3 turns the lint gate green. |
| E4 | Decide the `Windows-Deploy/` deletion | 15 min | 7,153 deletions sit unstaged. Commit or restore — do not let a broad `git add` decide. |
| E5 | Delete duplicate `jenkins-k8s.yaml` / `argocd-k8s.yaml` style leftovers | 20 min | `npm run config:check` shows which ids are real. |
| E6 | Add `npm run config:check` and `verify:dist` to CI | 30 min | Both already exist and exit non-zero. Just needs a pipeline to call them. |
| E7 | Set `startMode=AlwaysRunning` + preload on the IIS pool | 10 min | Without it the passive server only starts on first request — so failover is slow exactly when it matters. |
| E8 | Record the Sentinel TLS cert in `lifecycle.certificates` | 15 min | The tool should track its own certificate expiry. |
| E9 | Move the remaining 4 `docs/` images or compress them | 20 min | `docs/` is 2.2 MB, almost all images. |
| E10 | Add `.deployignore` for `tests/ tools/ docs/ deployments/` | 20 min | Removes 12 MB and 72 files from production hosts. |

**E1 through E3 in one sitting** gets you a pushed branch and a green lint gate.

---

## A. Code — remaining

### A1. Correctness
- [ ] Fix the 2 genuine severity-literal violations *(E2)*
- [ ] Narrow the severity lint regex to case-sensitive *(E3)*
- [ ] Wire `logs_collection/archival/s3_archiver.js` — built in Phase 3, never connected
- [ ] Clear `global.collectorEnvironment` after each collection pass; it currently leaks the last value (`prod`) to anything reading `ACTIVE_URLS` afterwards, including the DB pool
- [ ] Add an `AUTH_FAILED` badge to the UI so it is visibly distinct from `DATA_UNAVAILABLE`

### A2. Structure *(after Stage 1 is stable — do not do this before a release)*
- [ ] Move the six small workspace packages under `packages/` — `shared` (3 files), `logger` (2), `correlation` (2), `remediation` (6), `ai_analysis` (7), `inventory` (10). Takes top-level folders 18 → 13. Touches `setup_symlinks.js` and the `workspaces` array.
- [ ] Merge duplicate views, 17 tabs → 8:
  - [ ] `rca` + `timeline` — **render the identical component**
  - [ ] `blast-radius` + `timeline` + `RcaDashboard` → one Root Cause workspace
  - [ ] `matrix` → `health`
  - [ ] `entities` → `fleet`
  - [ ] `pbi` → `metrics`
  - [ ] `ailogs` → `logs`
  - [ ] `misc` → `admin`
- [ ] Remove `RcaDashboard` (430 lines, reachable from no tab)

> Merging views breaks constraint C1. Decide it deliberately, and do it **after** onboarding so usage evidence drives which surfaces survive.

### A3. Not yet proven
- [ ] Run against one real application end to end — **Jenkins first**
- [ ] Load test against real infrastructure, not a local fixture
- [ ] Prove the 14-app storage correlation scenario with real telemetry
- [ ] Verify log retention tiering end to end: local → DB → S3

---

## B. Deployment — Stage 1 shell

- [ ] `config/global.yaml:14` → `environment: "demo"`
- [ ] `config/global.yaml:38` and `:71` → `db_jdbc: ""` — **blank, not disabled**
- [ ] `applications_enabled` (`:139`) and `components_enabled` (`:122`) → all false
- [ ] `config/cyberark.yaml` → no production safes mapped
- [ ] `config/ui.yaml` → banner reads **"DEMONSTRATION DATA — NOT LIVE TELEMETRY"**
- [ ] `SENTINEL_JWT_SECRET` — same machine variable on **both** servers
- [ ] Both Windows servers built per `DEPLOYMENT.md`
- [ ] AVI virtual service, health monitor on `/healthz`, persistence enabled
- [ ] AVI SNAT addresses added to `trust proxy` (`backend/server.js:51`)
- [ ] `/ws` returns **101** through AVI
- [ ] Failover tested — stop SENTINEL-1, session survives
- [ ] Named application owner and technical owner recorded
- [ ] **Not** added to any incident runbook; CMDB classified **Pilot**

---

## C. Onboarding — one epic per application

Do **Jenkins first**: 5 Operations Centers, 10 controllers, ~250 agents, 4 build clusters. If the model survives Jenkins, the other twelve are variations.

Per application: endpoints → service account → vault the credential → `auth:` block → topology → collector parsing → log patterns → remediation job → enable.

- [ ] CloudBees Jenkins
- [ ] JFrog Artifactory
- [ ] Atlassian Bitbucket
- [ ] SonarQube
- [ ] JetBrains TeamCity
- [ ] Sonatype Nexus IQ
- [ ] Fortify SSC
- [ ] ArgoCD
- [ ] Argo Workflows
- [ ] GitHub Enterprise
- [ ] Aquasec
- [ ] OTKR
- [ ] Performance Center

**Infrastructure layers are their own epic and should land early** — the correlation engine blames infrastructure, and cannot do so without real infrastructure data.

- [ ] AVI · [ ] Kubernetes · [ ] NFS/Trident · [ ] Windows fleet · [ ] Linux fleet · [ ] SSO/eLDAP · [ ] Databases

### Agent rollout
- [ ] Fluent Bit via your existing config-management channel (SCCM / Ansible Tower)
- [ ] OTel collectors for the ~2,000 hosts
- [ ] Per-host configs generated from inventory
- [ ] Agent heartbeat — **a silent shipper looks exactly like a healthy application**
- [ ] Redaction at the shipper, before the line leaves the host

---

## D. Assurance — long lead times, book now

- [ ] Independent penetration test **booked**
- [ ] Penetration test passed
- [ ] SAST in CI — you already own Fortify
- [ ] DAST against a running instance
- [ ] SCA / `npm audit` as a build gate
- [ ] Threat model / STRIDE
- [ ] Security architecture sign-off
- [ ] Secrets scan across repo **and git history**
- [ ] Open-source licence review

---

## E. Operational acceptance — usually the real critical path

- [ ] Backup and **tested restore**; RPO/RTO agreed
- [ ] DR posture — what happens to Sentinel *during* a DR event
- [ ] Capacity model: disk/day at 2,000 hosts, IOPS, pool sizing
- [ ] Failure-mode testing and a degradation matrix
- [ ] **CI/CD pipeline for Sentinel itself** — none exists
- [ ] Branch protection; no direct commits to `main`
- [ ] SBOM, artifact signing, release tagging, documented rollback
- [ ] dev → SIT → UAT → prod promotion path
- [ ] Runbook and operations manual
- [ ] L1/L2/L3 support model; on-call rota **for Sentinel itself**
- [ ] Named owners — **bus factor is currently 1**
- [ ] CMDB reclassification to Tier-1; SLA/OLA
- [ ] NOC operator training
- [ ] Data classification and DPIA
- [ ] Retention schedule mapped to policy
- [ ] RBAC matrix signed off; SoD analysis on four-eyes
- [ ] Self-observability exported **elsewhere**
- [ ] **External dead-man's switch** — a monitoring platform that fails silently is worse than none

### Autonomous remediation — graduated, not granted
- [ ] Default off, manual trigger only
- [ ] Each runbook pre-approved as a SOX standard change
- [ ] ~20 clean manual executions before autonomy
- [ ] Autonomy enabled **per runbook**, never globally
- [ ] Every execution raises a CHG record
- [ ] Kill switch that needs no deploy

---

## F. Documentation debt

- [x] `CLAUDE.md` refreshed to match the code
- [x] `CODEBASE_MAP.md`, `PRODUCTION_IMPLEMENTATION_PLAN.md`, `DEPLOYMENT.md`, this file
- [ ] `docs/ARCHITECTURE.md` — still describes an `apps/`/`packages/` layout and claims controls that do not exist. See §20 of the remediation plan for the list.
- [ ] `docs/PRODUCTION_GUIDE.md` — same
- [ ] `README.md` — same stale layout

---

## Sequencing

```
Easy wins (E1-E3)   ──►  Stage 1 deploy (B)  ──►  Jenkins onboarding (C)
                                                        │
                            Assurance (D) ──────────────┤  start booking NOW
                            Operational (E) ────────────┘  sets the go-live date
```

**The moment the first real application is onboarded, Sentinel stops being a demo.** People start trusting it, and every Tier-1 obligation in D and E activates. Start those when epic one *begins*, not when it ends.
