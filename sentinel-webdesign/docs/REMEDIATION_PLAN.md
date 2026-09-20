# Project Sentinel — Remediation Plan to Meet Production Requirements

**Audience:** the coding agent executing this work.
**Status:** plan only. No code has been written against it yet.
**Canonical source:** this file. If it conflicts with `README.md` or `docs/ARCHITECTURE.md`, this file wins — those two still describe an `apps/`/`packages/` layout the repo no longer uses.

---

## 0. How to use this document

Work the phases **in the order this document presents them** (sections 4-13) — that sequence is the execution order, not just the numbering. Phase N assumes Phase N−1 has landed, because each phase removes an architectural blocker for the next. Do not start Phase 4 (the correlation engine) before Phase 1 (entity model) — the correlation engine is a graph traversal and there is currently no graph to traverse.

Every task below states: **what to change**, **which files**, and **how it is verified**. A task is not done until its acceptance check passes.

**Validate every phase by launching the application**, not only by unit tests — section 23 defines the harness, the mock upstream server, and the per-phase launch checks. Open a separate PR per phase. Keep each PR runnable — `npm test` and `npm run lint` must pass at the end of every phase.

---

## 1. Non-negotiable constraints

These are hard requirements from the product owner. Violating any of them fails the review regardless of how good the code is.

| # | Constraint |
|---|---|
| C1 | **Existing UI/UX design must not change.** No restyling, no relayout, no renamed tabs, no altered component hierarchy in existing views. |
| C2 | New capability that needs screen space ships as a **new View** (a new tab), reusing the existing nav pattern and existing CSS classes from `frontend/src/App.css`. No new design language, no new component library, no new fonts or colors. |
| C3 | **Existing API response shapes must not change.** The frontend binds to them. New capability goes on new `/api/v2/*` endpoints; old endpoints become thin adapters over the new stores. |
| C4 | **Production and staging must never fabricate data.** Missing or unreachable data surfaces as `null` / `'Data Not Available'` / `SEVERITY.DATA_UNAVAILABLE`. Only `demo` may synthesize. This rule is already enforced by `tests/data_availability_segregation.test.js`, `tests/env_strict_value_not_available.test.js`, `tests/prod_data_availability.test.js` — keep them green. |
| C5 | Severity, status, color and weight values come only from `@sentinel/shared-constants`. `npm run lint:constants` must stay green. |
| C6 | No agent installation is possible on non-DevSecOps-owned systems. Collection from those systems is **URL and exposed-metrics only**. Do not design anything that assumes an agent on a host the team does not own. |
| C7 | Fluentd / Fluent Bit and Prometheus node_exporter **are** installable on the Windows, Linux and Kubernetes estate the team owns. Design for those. |
| C8 | Dynatrace is an **optional, removable** source. Nothing outside its adapter may import it or assume it exists. |
| C9 | Database migrations must be reversible and must not require downtime on a running deployment. |

---

## 2. Repo-specific gotchas the agent will hit

Read these before touching anything.

1. **Workspace symlinks.** Modules import each other as `@sentinel/*` (`analysis`→`ai_analysis`, `api`→`backend`, `collector`→`metrics_collection`, `config`→`backend/config`, `database`, `logger`, `remediation`, `shared-constants`→`shared`). They resolve via symlinks created by `scripts/setup_symlinks.js` in `node_modules/@sentinel`. If a require fails, run `npm run setup`. **Any new package directory must be registered in that script.**
2. **`config.ACTIVE_URLS` is a getter**, not a value. It resolves prod-vs-staging at call time from `global.runtimeEnvironment`. Never destructure or cache it at module load.
3. **Parallel `real/` and `simulation/` trees** exist under `metrics_collection/`, `logs_collection/` and `remediation/`, selected once at startup by `USE_SIMULATED_COLLECTORS`. A new collector must be added to **both** trees with matching exports, or startup breaks in one mode.
4. **YAML config is cached in-process** (`backend/config/yaml_config.js`). Cache only clears via its own save functions. Edits on disk need a restart.
5. **Component ids are shared strings** across YAML `id`, collector filenames, `db.js` demo profiles, health components and recovery workflows (`jenkins_k8s`, `avi_load_balancer`, `nas_performance`). Renaming one means touching all.
6. **Cross-module calls go through globals** to dodge circular deps: `global.broadcastStateChange`, `global.broadcastLog`, `global.runtimeEnvironment`, `global.runSelfHealingOrchestrator`, `global.runPredictiveAnalysis`. Preserve these during refactors or the WebSocket stream goes silent.
7. **`backend/auth/session.js` calls `process.exit(1)` at require time** if `SENTINEL_JWT_SECRET` is unset. Any test importing the auth chain needs it in the environment.
8. **Tests are plain `node` scripts** using `assert`, run sequentially by `npm test`. There is no test framework. Add new tests the same way and register them in the `test` script in `package.json`.

---

## 3. Target architecture

### 3.1 Process topology

Today everything runs in one Node process: API + WebSocket + all collectors + AI + remediation. That cannot carry 2,000 servers. Split into three roles, same repo, same workspace:

```
sentinel-api        Express + WebSocket + read APIs. No collection.
sentinel-collector  Collector workers, sharded by entity hash. N instances.
sentinel-ingest     OTLP metric + log ingest, batching into TimescaleDB.
                    (May run inside sentinel-api at first; must be separable by config.)
```

`backend/server.js` currently calls `collector.start()` inside `server.listen()` — that call moves out behind a `SENTINEL_ROLE` env var (`api` | `collector` | `ingest` | `all`, default `all` for local dev so the existing developer workflow is unchanged).

### 3.2 Storage tiers

| Tier | Holds | Retention | Backed by |
|---|---|---|---|
| Hot memory | Write-ahead queue, live WS state | seconds | in-process ring buffer |
| Warm DB | Raw metrics | 7 days | TimescaleDB hypertable |
| Warm DB | Metric rollups 1m / 1h | 30 days / 400 days | Timescale continuous aggregates |
| Warm DB | Parsed logs | 14 days | TimescaleDB hypertable + compression |
| Local disk | Raw log files | ~3 weeks | existing `logger/logger.js` rotation |
| Cold | Archived logs | indefinite | S3, daily gzip/parquet partitions |

`.runtime/sentinel_db.json` is **demoted to settings and small control state only**. It stops being the metric store.

### 3.3 Scale budget (use as acceptance targets)

- 2,000 hosts × ~15 metrics ÷ 30s ≈ **1,000 metric rows/sec sustained**, design headroom **5,000/sec burst**.
- Log ingest **5,000 lines/sec sustained**.
- This is comfortably inside a single well-tuned TimescaleDB instance. The current failure is not the database — it is that the app writes one row per `INSERT` and rewrites a JSON file per metric.

---

### 3.4 Deployment topology and HA

The monitoring platform must not be less available than what it monitors.

- **Active-passive pair** for `sentinel-api` across two Windows hosts behind the AVI VIP, health-checked on `/healthz`, sharing one TimescaleDB. Failover is an AVI pool decision, not application logic.
- **Collectors are stateless and sharded**, so a lost collector host costs coverage of its shard until it is replaced or reshuffled, never correctness.
- **Separate prod and non-prod deployments** (see T1c.6). Prod Sentinel holds only prod credentials and reaches only prod.
- **External dead-man's switch.** Sentinel emits a heartbeat to an independent system, which alerts on its absence. A monitoring platform that fails silently is worse than none, and self-monitoring is circular.
- Sentinel's own metrics and logs are exported **elsewhere**, never only into itself.

### 3.5 Build-vs-buy decision record

An architecture review will ask why the project builds a time-series store, a log index, a query UI and an alerting engine — four solved problems — to obtain one unsolved one. Record the answer so it is not relitigated each phase.

**What is genuinely differentiated and stays bespoke:** the DevSecOps topology model, fan-out correlation, four-eyes remediation governance, and the expiry radar. Nothing off the shelf does these against this estate.

**What is commodity:** metric storage, log storage and search.

**Decision: put the commodity layer on PostgreSQL / TimescaleDB.** In this organisation Postgres is already an approved, backed-up, DBA-supported platform with an existing support contract — no new infrastructure approval, no new on-call rota, no new vendor. A generically "better" observability stack (VictoriaMetrics / Prometheus + Loki) would be the stronger engine but needs approval, capacity and a support model, and the team has already been burned by k8s-hosted OpenSearch.

**Constraint that keeps the door open:** the commodity layer is deliberately boring and replaceable. Keep metric and log storage behind an interface so migrating to a dedicated TSDB later is a driver swap, not a rewrite. Revisit if sustained ingest exceeds roughly 5,000 rows/sec or log retention needs to exceed 30 days.

---

## 4. Phase 0 — Correctness and security fixes

**Goal:** stop the bleeding. Small, self-contained, no schema change. Land this first so later phases build on a trustworthy base.

> **Scope expanded after the full code + documentation sweep.** Phase 0 now carries 20 items, several of them exploitable today. Read §4.1 (new findings) before starting — three of them compose into a credential-exfiltration chain, and one of them is currently blocked only by an unrelated bug.

### 4.1 — Findings from the full code + documentation sweep

These were found after the plan's first draft. Several are exploitable today.

#### The credential-exfiltration chain (fix as one unit)

Four weaknesses compose:

1. `requireAuth` grants anonymous mutating requests **Super Admin**.
2. `POST /api/yaml/raw` accepts arbitrary YAML from a Super Admin.
3. `yamlConfig.updateRawYaml(null, content)` **overwrites `config/global.yaml` wholesale** — the file holding every `prod_urls.*` endpoint.
4. Collectors then authenticate to those endpoints with real CyberArk-resolved production tokens.

Result: an unauthenticated attacker repoints the collector fleet at a host they control and harvests live Jenkins, Artifactory, Bitbucket and database credentials.

> **It is currently blocked by an accident.** `backend/config/bitbucket_pr_service.js` has **zero `require` statements** — `yamlConfig`, `writeNasLog` and `repoSlug` are all undefined, so the module throws `ReferenceError` on first call. **DO NOT simply add the missing imports.** That converts dead code into a live critical vulnerability. Follow T0.13 instead.

#### T0.11 — Rate limiters are bypassable

`backend/server.js:46` sets `app.set('trust proxy', true)` (trust *all* proxies), so `req.ip` derives from the client-controlled `X-Forwarded-For` header. All three limiters key on `req.ip`, so rotating that header yields unlimited buckets — including the login limiter, which reopens credential stuffing. The limiter configs also pass `validate: { trustProxy: false }`, which **silences the library's own warning about exactly this misconfiguration**.

Fix: `app.set('trust proxy', 1)` or an explicit proxy IP list; re-enable the validator.

**Accept:** 60 login attempts with rotating `X-Forwarded-For` values → 429 before attempt 51.

#### T0.12 — CORS admits any `*.corp` / `*.internal` origin with credentials

`cors_validator.js` allows `hostname.endsWith('.corp')`, `hostname.endsWith('.internal')`, and bare `hostname === 'corp'`. The existing test asserts `evilcorp.com` is rejected but never tests `evil.corp`, which **passes**. With `credentials: true`, one XSS anywhere in the `.corp` namespace pivots to authenticated Sentinel control.

Fix: exact-match allowlist from config only. Delete all suffix matching.

**Accept:** `https://evil.corp` and `https://x.internal` rejected; the configured origin accepted.

#### T0.13 — Make configuration immutable at runtime

Delete `POST /api/yaml/raw`, `POST /api/yaml/create-pr`, `POST /api/webhooks/bitbucket-pr-merged`, and `backend/config/bitbucket_pr_service.js` entirely. Keep the `GET /api/yaml/*` read endpoints.

Rationale beyond the security chain: the PR service never called the Bitbucket API. It generated a random 3-digit PR id, wrote log lines *claiming* branches and commits occurred, and stored state in an in-memory `Map` lost on restart. The merge webhook was unauthenticated with guessable ids (~900 attempts).

Config changes go through the real Git repo and a redeploy. The YAML editor View stays visually identical but becomes read-only with a copy-to-clipboard action.

#### T0.14 — Delete seeded audit and SSO records

`database/postgres_users.js` (which contains no Postgres — it is a JSON file) seeds `defaultAuditLogs` and `defaultSsoLogs` with invented entries carrying real-looking LDAP DNs, internal IPs, session ids and remediation actions. A **Security Auditor** opening that screen today is shown fabricated compliance evidence, indistinguishable from real records.

Fix: remove all seed data. Empty state renders "No records." Audit and SSO views read only from the append-only store, and are the one place a `demo` fallback is **forbidden outright**.

#### T0.15 — The synthetic prober fabricates health

`metrics_collection/real/python_checks/runner.js` resolves `{ status: 'Healthy', latency_ms: 85 + random(20), login_success: true }` on **any** failure — Python absent, script error, non-JSON output. `jenkins_collector.js` consumes that value as its `responseTime`. On a Windows Server without Python (the default), Jenkins response time is a random number between 85 and 105ms **in production**.

Fix: return `DATA_UNAVAILABLE` on every failure path; add a spawn timeout with kill; bound concurrent spawns.

#### T0.16 — Audit logging cannot carry a SOX trail

Four defects in 70 lines: unbounded file with no rotation; `getAuditLog()` does `readFileSync` of the **entire** file on every dashboard hit (OOM plus a trivial DoS); fire-and-forget async writes whose failures are logged and dropped; and attribution is **falsified** — anonymous actions record as `admin_operator@enterprise.corp` because of the `requireAuth` fallback.

`web.config` also sets `stdoutLogEnabled="false"`, so the `console.info` line intended for SIEM pickup is **discarded in production**. The only SIEM path is off.

Fix: append-only Postgres table, durable write, forward to enterprise SIEM as system of record, paginated reads, enable stdout capture.

Principle: *a system that can change production cannot be the sole custodian of the record of those changes.*

#### T0.17 — Remove the second full-file rewrite per metric

`database/sqlite_metrics.js` contains no SQLite — it is a JSONL file, and `archiveMetrics()` does `readFileSync(whole file)` → concat → `slice(-100)` → `writeFileSync(whole file)` **on every metric write**, in addition to `saveDB()`. Two full-file I/O cycles per metric. It retains 100 rows and has no environment filter.

Fix: delete the module and its call site.

#### T0.18 — Fix Postgres environment segregation

`postgres.js` INSERT omits the `environment` column entirely (the documented DDL defaults it to `'prod'`), and `fetchHistoricalMetricsFromPostgres()` has **no environment filter in its WHERE clause** — so `?environment=prod` and `?environment=staging` return identical rows. `sqlite_metrics.queryHistoricalMetrics()` has the same gap.

The three segregation test suites pass because they exercise `db.js` (in-memory) only. **The control is tested at the wrong layer.**

Fix: write and filter `environment`; backfill or truncate existing rows; **move the segregation tests down to the persistence layer.**

#### T0.19 — Dependency and PII remediation

- `xlsx@0.18.5`: prototype pollution (CVE-2023-30533, fixed in 0.19.3) and ReDoS (fixed in 0.20.2). SheetJS no longer publishes to npm, so the registry package is permanently stale. It parses untrusted uploads at `/api/misc/rota/upload`. Replace with `exceljs`, or drop upload and accept CSV only with a hand-rolled parser.
- `ldapjs` **is not installed** — the production auth path cannot work. Add it (required by T0.6).
- Express 4 is in maintenance; plan the Express 5 migration.
- Wire `npm audit` and SCA into CI as a build gate.
- **PII in source control:** `database/sentinel_users.json` is git-tracked (names, corporate emails, roles, LDAP DNs, IPs). `ai_analysis/team_rota_service.js` hardcodes ~15 people with corporate emails **and mobile/pager numbers**. Purge from the working tree **and from git history**, add to `.gitignore`, replace with generated non-identifying placeholders.

#### T0.20 — Modules that lie about what they are

`postgres_users.js` (a JSON file), `sqlite_metrics.js` (a JSONL file). `custom_checks.js` initialises every check to `status: "Healthy", latencyMs: 12` **before running anything**, and hardcodes `billing-service` / `payment-gateway` staging endpoints.

Fix: rename to what they are or delete; initialise check state to `UNKNOWN`, never `Healthy`; move the check registry into YAML.

---

#### T0.21 — Move the session token out of `localStorage`

`frontend/src/App.jsx` reads the JWT from `localStorage['sentinel_auth_token']` in at least five places. Combined with the permissive CSP (T0.8), any script injection is a full session takeover — and that session can trigger production Jenkins jobs.

Fix: `httpOnly; Secure; SameSite=Strict` cookie plus a CSRF token on mutating requests. The WebSocket upgrade takes the cookie rather than a `?token=` query parameter, which also stops the token appearing in proxy and IIS access logs.

**Accept:** no token readable from `document.cookie` or `localStorage`; a cross-site form POST without the CSRF token returns 403.

---

### 4.2 Remediation governance model

T0.1 fixes the four-eyes *bypass bug*. This defines the governance that makes autonomous remediation acceptable to a BFSI risk function at all — without it, the fix is technical and the capability still will not be approved.

Note the current state is worse than "autonomous by choice": it is **autonomous by accident**, because the argument-order bug silently skips approval. Nobody has consciously accepted that risk, which is itself the finding.

**Graduated autonomy.** A runbook earns autonomy with evidence rather than being granted it up front:

1. **Default off.** Every runbook starts manual-trigger-only.
2. **Pre-approval.** Each runbook is individually approved as a **SOX standard change**, with a documented blast radius, target systems, and rollback. Blanket approval for "auto-remediation" will not be granted and should not be requested.
3. **Evidence period.** A runbook stays manual until it has executed N times (suggest 20) under four-eyes approval with a clean record.
4. **Promotion.** Autonomy is enabled **per runbook**, never globally. `autonomousMode` stops being a single boolean and becomes a per-runbook flag.
5. **Ticketing.** Every execution, manual or autonomous, auto-raises a ServiceNow CHG record referencing the pre-approved standard change.
6. **Kill switch.** A single operator control halts all autonomous execution immediately, without a deploy or restart. It is an explicit, audited action.

**Segregation of duties.** The two four-eyes approvers must be distinct humans — the existing username dedup is necessary but not sufficient. Service accounts must not be able to approve. Whoever requests a remediation cannot be one of its approvers. Record the SoD analysis for the control owner's sign-off.

---

### T0.1 — Fix the four-eyes approval bypass
`metrics_collection/collector_coordinator.js` calls `triggerRecovery(comp, reason, env)`. The signature in `remediation/recovery.js` is `triggerRecovery(component, triggerReason, isManualTrigger, env)`. The environment string lands in `isManualTrigger`, is truthy, and **every automatic recovery skips the approval queue and fires a Jenkins job unreviewed.**

Fix: change all call sites to pass an explicit options object — `triggerRecovery(component, reason, { manual: false, env })` — and update the signature. Audit every caller (`collector_coordinator.js`, `recovery.js` internal, `backend/server.js`).
**Accept:** new test asserts an auto-triggered recovery lands in `Awaiting-Approval` when `autonomousMode` is false, and that two distinct approvers are required to execute.

### T0.2 — Fix alert environment tagging
`ai_analysis/real_analyzer.js` calls `db.addAlert(component, severity, message, env)` but the signature is `(component, severity, message, status, env)`. The env string is written into `status`, so the alert is mistagged and invisible to env-filtered queries.
**Accept:** test asserts an alert raised for `prod` is returned by `db.getAlerts('prod')` and not by `getAlerts('staging')`.

### T0.3 — Fix `runSelfHealingOrchestrator` arity
Coordinator calls it with `(infraMetrics, env)`; `remediation/recovery.js` accepts only `(currentMetrics)`. Add and honour the `env` parameter.

### T0.4 — Remove the OTLP double-write
`backend/server.js` `POST /v1/metrics` calls `db.addMetricBatch(...)` **and then** loops `db.addMetric(...)` over the same rows — every metric is written twice, including to Postgres. Delete the loop.

### T0.5 — Close the anonymous Super Admin hole
`requireAuth` in `backend/server.js` assigns unauthenticated mutating requests `{ username: 'admin_operator@enterprise.corp', role: 'Super Admin' }`. RBAC is currently decorative.
Fix: return `401` for mutating `/api/*` without a valid token. Keep the fallback **only** when `USE_SIMULATED_COLLECTORS === true` and `NODE_ENV !== 'production'`, logged loudly at startup.
**Accept:** `tests/auth_lockdown.test.js` extended — anonymous `POST /api/settings` returns 401; `NOC Operator` token on `POST /api/recovery/approve` returns 403; `SRE Lead` returns 200.

### T0.6 — Implement the real LDAP bind
`backend/auth/ldap_client.js` production path resolves a CyberArk bind credential and then unconditionally rejects with "not yet configured". Implement the `ldapjs` bind, read `memberOf`, map groups to roles via the existing `resolveRoleFromGroups()` and `config/infra/sso-eldap.yaml` `role_mappings`. Keep the staging test-user table gated behind non-production only.

### T0.7 — Harden the token and session layer
Replace the hand-rolled HS256 in `backend/auth/session.js` with `jose`. Add `kid` header, support two active signing keys for rotation, and a revocation list keyed by `jti` in the DB. Keep `generateToken` / `verifyToken` signatures so callers are unaffected.

### T0.8 — Tighten CSP
`backend/server.js` helmet config allows `'unsafe-inline'` on scripts and `http:` in `connectSrc`. Move to nonce-based inline handling, drop plain `http:` outside local dev.

### T0.9 — Move users off the filesystem
`database/postgres_users.js` is named for Postgres but persists to `database/sentinel_users.json`. Implement real Postgres-backed storage with the JSON file as an explicit dev-only fallback.

**Phase 0 exit criteria:** all existing tests green; four new tests (T0.1, T0.2, T0.5, T0.6) green; no behaviour change visible in the UI.

---

## 5. Phase 1 — Entity model and inventory

**Goal:** give the system a concept of *a server*. This is the foundation for fleet scale, regions, and every form of correlation. Nothing else in the plan works without it.

### The problem
A metric row today is `{ timestamp, component, metricName, value, env }` where `component` is a flat string like `"jenkins_k8s"`. There is no host dimension. 200 Windows build agents have nowhere to be represented — they collapse into one component. The OC→controller→agent hierarchy, regions, and the app→infra dependency graph are all inexpressible.

### T1.1 — Schema
New migration directory `database/migrations/` with a simple forward/back runner (`database/migrate.js`, invoked by `npm run migrate`).

```sql
CREATE TABLE entity (
  entity_id    TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,      -- app|oc|controller|agent|host|db|avi|k8s_cluster|k8s_node|storage|url|service|sensor
  name         TEXT NOT NULL,
  app_id       TEXT,
  region       TEXT,               -- emea|apac|amer
  environment  TEXT NOT NULL,      -- prod|staging|demo
  parent_id    TEXT REFERENCES entity(entity_id),
  labels       JSONB NOT NULL DEFAULT '{}',
  source       TEXT NOT NULL,      -- yaml|otlp|jenkins_api|teamcity_api|k8s_api|avi_api
  status       TEXT,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON entity (app_id, environment);
CREATE INDEX ON entity (kind, region, environment);
CREATE INDEX ON entity (parent_id);

CREATE TABLE entity_edge (
  from_entity TEXT NOT NULL REFERENCES entity(entity_id) ON DELETE CASCADE,
  to_entity   TEXT NOT NULL REFERENCES entity(entity_id) ON DELETE CASCADE,
  edge_type   TEXT NOT NULL,       -- runs_on|routes_through|stores_on|member_of|depends_on|resolves_to|scanned_by
  confidence  REAL NOT NULL DEFAULT 1.0,
  source      TEXT NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_entity, to_entity, edge_type)
);
CREATE INDEX ON entity_edge (to_entity, edge_type);
```

### T1.2 — Inventory service
New workspace package `inventory/` (register it in `scripts/setup_symlinks.js` as `@sentinel/inventory`).

Responsibilities: upsert entities and edges from all sources, resolve a stable `entity_id`, mark entities stale when unseen past a TTL, expose a query API.

`entity_id` scheme — deterministic, stable across restarts:
```
app:<app_id>
host:<fqdn>
agent:<app_id>:<agent_name>
controller:<oc_id>:<controller_name>
k8snode:<cluster_id>:<node_name>
avi:<vs_name>
storage:<volume_id>
url:<hostname>
```

### T1.3 — Inventory sources
Implement each as a discrete adapter under `inventory/sources/`:

1. **YAML** — declarative topology from `config/apps/*.yaml` and `config/infra/*.yaml` (the schema extension is T1.4).
2. **OTLP self-registration** — every OTLP push carries `host.name`, `service.name`, `k8s.*` resource attributes. Auto-create the host entity on first sight and link it to its app. **This is how the ~2,000 servers get registered without anyone maintaining a list.**
3. **Jenkins API** — `GET <oc>/computer/api/json` per Operations Center enumerates controllers and the live build-agent fleet (the 200 Windows + 50 Ubuntu agents). Poll every 5 minutes.
4. **TeamCity API** — `GET /app/rest/agents` for the 100 agents.
5. **Kubernetes API** — nodes and pods per cluster, for the OC controller clusters and the CI/CD build-agent clusters.
6. **AVI** — virtual services and pool members, to build `routes_through` edges.

Each adapter is independently disableable via `config/global.yaml` toggles and must degrade to "no new entities" rather than throwing.

### T1.4 — YAML schema extension
Extend the app manifest schema. Example for `config/apps/cloudbees-jenkins.yaml`, which currently declares **one** server node and cannot express the real topology:

```yaml
id: "cloudbees_jenkins"
kind: "application"
regions: ["emea", "apac", "amer"]

topology:
  operations_centers:
    - id: "oc-01"
      region: "emea"
      url: "https://oc01.internal.corp"
      k8s_cluster: "k8s-oc-emea-01"
      controllers:
        - { id: "oc-01-aps", flavour: "APS", url: "https://oc01-aps.internal.corp" }
        - { id: "oc-01-dev", flavour: "DEV", url: "https://oc01-dev.internal.corp" }
    # ... oc-02 .. oc-05
  agent_pools:
    - { id: "win-build",  os: "windows", expected_count: 200, discovery: "jenkins_api" }
    - { id: "linux-docker", os: "linux", expected_count: 50,  discovery: "jenkins_api" }
  jump_servers:
    - { host: "jump-01.internal.corp", os: "linux" }
    - { host: "jump-02.internal.corp", os: "linux" }
  build_clusters:
    - { id: "k8s-ci-build",      purpose: "ci" }
    - { id: "k8s-cd-build",      purpose: "cd" }
    - { id: "k8s-cd-apac-build", purpose: "cd", region: "apac" }
    - { id: "k8s-cd-amer-build", purpose: "cd", region: "amer" }

lifecycle:
  refweb_url: { url: "https://jenkins.internal.corp", expiry: "2027-03-31" }
  license:    { type: "CloudBees CI", expiry: "2027-01-15" }
  certificates:
    - { name: "ingress-tls", probe: "jenkins.internal.corp:443" }
```

`expected_count` matters: discovered-vs-expected agent count is itself a health signal.

Apply the same treatment to `jetbrains-teamcity.yaml` (100 agents), `fortify.yaml` (1 SSC + 20 sensors), `jfrog-artifactory.yaml` (4 app + 2 xray EMEA, 2+2 per mirror region), `bitbucket.yaml` (15 EMEA nodes, 5 per mirror region).

### T1.5 — Consolidate duplicate app identities
`config/apps/jenkins.yaml`, `jenkins-k8s.yaml` and `cloudbees-jenkins.yaml` declare three different ids, so Jenkins renders as three separate entities. Same pattern for `argocd`/`argocd-k8s`, `argoworkflows`/`argoworkflows-k8s`, `artifactory`/`jfrog-artifactory`, `teamcity`/`jetbrains-teamcity`.
Collapse each to one manifest with the sub-components expressed in `topology`. Keep the retired ids in an `aliases:` list so existing metric history and recovery workflows still resolve.

### T1.6 — Add the missing applications
Create manifests for: **Aquasec** (image scanning, URL-only per C6), **code review service**, **MCP server**, **auto-remediation service** (the three local AI helpers on k8s). `config/apps/mcp-server-k8s.yaml` exists but needs the extended schema.

### T1.7 — Carry the entity through the metric path
Add `entity_id` to the metric write path end to end: `metrics_collection/real/opentelemetry/otlp_metric_normalizer.js` resolves it from resource attributes; `database/db.js` `addMetric`/`addMetricBatch` accept and persist it. **Keep `component` populated as before** — existing API responses and the UI depend on it (C3).

**Phase 1 exit criteria:** `GET /api/v2/entities?kind=agent` returns the discovered Jenkins agent fleet; a synthetic OTLP push from an unknown host auto-creates its entity and links it to its app; all existing tests still green.

---

## 6. Phase 1b — Collector authentication

**Goal:** let collectors actually reach SSO-protected systems. **24 of 26 real collectors send no credentials at all** — only `dynatrace_collector.js` and `avi_collector.js` set an `Authorization` header, and there is no `https.Agent`, no client-certificate handling, no `pfx` anywhere in the codebase.

Against a SAML-protected application a bare `fetch()` receives a **302 to the IdP**, not JSON. `fetch_with_fallback.js` treats a non-OK response as `{ success: false }`, which the app collector renders as DATA_UNAVAILABLE. **The URL was never the missing piece — the credential is.**

### The reframe: do not do SAML for collection

SAML is a human browser-login protocol. For machine-to-machine, each of these tools offers a token path that bypasses the SSO filter. Use it.

| Tool | Collection auth |
|---|---|
| CloudBees Jenkins | Service user + API token (Basic); crumb for POSTs |
| Artifactory | Access token (Bearer) |
| Bitbucket DC | HTTP access token (Bearer) |
| SonarQube | User token as Basic username, empty password |
| TeamCity | Access token (Bearer) |
| Nexus IQ | User token (Basic) |
| Fortify SSC | Short-lived token minted from `/api/v1/tokens` |
| ArgoCD / Argo Workflows | Account token / k8s ServiceAccount token |
| Kubernetes | ServiceAccount token + CA cert |
| AVI | Genuinely session-based — POST login, keep cookie + CSRF token |
| Aquasec, OTKR, Performance Center | Confirm with the platform team; fall back to URL-probe only |

Three schemes cover the estate: **bearer/basic token**, **mTLS** (where the AVI or app demands a client certificate), and **cookie session** as a last resort.

Keep the distinction clear: **collection avoids SAML; the synthetic prober exercises SAML deliberately**, because verifying that human SSO login works is the prober's entire purpose.

### T1b.1 — `auth:` block in the app manifest schema

```yaml
auth:
  scheme: bearer_token        # bearer_token | basic_token | mtls | cookie_session | none
  credential_purpose: api_token
  cert_purpose: null          # for mtls: CyberArk object holding cert + key
  username_purpose: null      # for basic_token schemes needing a user
  session:                    # cookie_session only
    login_path: /login
    csrf_header: X-CSRFToken
```

### T1b.2 — Authenticated fetch wrapper

Replace the bare `fetch_with_fallback.js` with an authenticating client that resolves credentials via the CyberArk provider, builds the right header or `https.Agent` per scheme, caches sessions with refresh, and retries once on 401 after re-minting.

### T1b.3 — `AUTH_FAILED` is a distinct state

Today a 302-to-IdP, a 401 from a rotated token, and a genuinely dead application all collapse to DATA_UNAVAILABLE. Add a distinct `AUTH_FAILED` state threaded through the collector result, health calculation and UI badge.

**Why this matters more than it looks:** without it, the first token rotation pages your on-call for a fake Sev1, and people stop trusting the tool inside a week.

### T1b.4 — Least privilege and Tier-0 containment

Sentinel becomes a credential aggregator for 13 privileged tool accounts — compromise it and you reach Jenkins, Artifactory, Bitbucket and the k8s API in one hop.

- Read-only scoped service account per tool, one CyberArk object each.
- **Zero write scopes, with one exception: the Jenkins remediation token, scoped to a fixed allow-list of job names.** Without that scoping, a Sentinel compromise is arbitrary code execution on the CI estate.
- Credentials never at rest on disk, never in the JSON store, fetched per use, every fetch audited with the requesting module.
- Client certificates are tracked by the expiry radar (T5.4) — their expiry takes out monitoring for every app simultaneously.

**Phase exit:** every configured app returns either real data or an explicit `AUTH_FAILED` / `DATA_UNAVAILABLE` with a reason. No app silently reports healthy because nobody checked.

---

## 7. Phase 1c — Per-user environment isolation

**Goal:** User A viewing PROD must not change what User B sees on STG. Today it does, and the consequences reach beyond the UI.

### The mechanism

`runtimeEnvironment` is a **single module-scope variable** (`backend/server.js:70`), mirrored onto `global.runtimeEnvironment`. `POST /api/environment` mutates it server-wide. Then:

1. The 5-second `metrics_tick` calls `calculateHealthState()` with no argument, so it uses the global, and `broadcast()`s the result to **every connected client**.
2. `frontend/src/App.jsx` on every tick runs `if (data.health?.environment) setEnvironment(data.health.environment)` — **forcibly overwriting each user's own selection**.

So User A clicks PROD and within five seconds every user watching STG is dragged to PROD, alerts and recovery panels included.

### Three consequences worse than the UI flip

- **Collector lifecycle:** selecting DEMO calls `collector.setDemoActive(true)`, changing collection behaviour server-wide. Switching back calls `clearAllSimulations()`, wiping another user's in-flight simulation.
- **Credential and endpoint context:** `config.ACTIVE_URLS` resolves from the same global, so one user's click changes which endpoints every collector targets and which credentials it fetches.
- **Telemetry corruption:** `backend/server.js:385` tags inbound OTLP with `runtimeEnvironment`. **One user sitting on DEMO causes all production telemetry from 2,000 hosts to be written tagged `demo`.** Combined with T0.18, production history is being corrupted by a UI click.

### T1c.1 — Environment becomes session state

Carry the selected environment in the session (JWT claim or server-side session record), never in a module global. Every read path takes it as an explicit parameter — most REST handlers already accept `?environment=`, so this is mostly deleting the `|| runtimeEnvironment` fallbacks.

### T1c.2 — WebSocket subscription scope

On connect, the client declares `{ environment, view, entity_ids[] }`. The server maintains per-connection scope and computes each frame for that scope. Compute health **once per distinct environment per tick**, not once per client.

Frame types and payload shapes stay identical (C3).

### T1c.3 — Client stops accepting environment from broadcasts

Remove `setEnvironment(data.health.environment)` from the `init`, `metrics_tick` and `state` handlers. The user's selection is authoritative for their own session. **Zero visual change** — the switcher looks and behaves identically; it simply stops being global.

### T1c.4 — Ingest tagging comes from the agent, never the UI

`POST /v1/metrics` derives environment from the OTLP resource attributes (or the ingest credential's bound environment), never from `runtimeEnvironment`. Same for `/v1/logs`.

### T1c.5 — Demo becomes session-scoped

Demo data is synthesized per request for the session that asked for it. It never starts or stops a server-wide collector lifecycle and never clears another session's simulations.

### T1c.6 — Separate prod and non-prod deployments

Beyond per-user isolation: a single process that can be flipped into production context by an HTTP call — one that currently does not even require authentication — is a segregation-of-duties finding. Prod Sentinel holds only prod credentials and reaches only prod. The environment switcher becomes a read-only view selector, or is dropped for prod entirely.

**Phase exit:** two browser sessions, one on PROD and one on STG, hold their selections indefinitely under active collection. A third session selecting DEMO changes neither. OTLP pushed during all of it is tagged from agent attributes.

---

## 8. Phase 2 — Ingest and storage rewrite

**Goal:** survive 1,000 metric rows/sec sustained. Today the system caps its buffer at 200 rows globally and rewrites a JSON file on every single metric.

### T2.1 — Metric schema and rollups

```sql
CREATE TABLE metric (
  ts          TIMESTAMPTZ NOT NULL,
  entity_id   TEXT NOT NULL,
  component   TEXT NOT NULL,       -- legacy alias, preserves existing API shape
  metric_name TEXT NOT NULL,
  value       DOUBLE PRECISION,
  environment TEXT NOT NULL,
  labels      JSONB
);
SELECT create_hypertable('metric', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX ON metric (entity_id, metric_name, ts DESC);
CREATE INDEX ON metric (component, metric_name, ts DESC);

-- continuous aggregates
CREATE MATERIALIZED VIEW metric_1m WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 minute', ts) AS bucket, entity_id, component, metric_name, environment,
         avg(value) AS avg_value, max(value) AS max_value, min(value) AS min_value, count(*) AS sample_count
  FROM metric GROUP BY 1,2,3,4,5;
-- metric_1h defined the same way

SELECT add_retention_policy('metric', INTERVAL '7 days');
SELECT add_retention_policy('metric_1m', INTERVAL '30 days');
SELECT add_retention_policy('metric_1h', INTERVAL '400 days');
SELECT add_compression_policy('metric', INTERVAL '2 days');
```

If TimescaleDB is unavailable in the target estate, fall back to plain Postgres with monthly `PARTITION BY RANGE (ts)` and cron-driven rollup tables. Decide this before starting T2.2 and record the decision in the PR.

### T2.2 — Replace the write path
Rewrite `database/db.js`:
- Introduce a bounded in-memory **write-ahead queue** (default 50,000 rows).
- A flusher drains it every 1s **or** at 5,000 rows, whichever first, using a single multi-row `INSERT` (or `COPY` for large batches).
- **Delete `saveDB()` from the metric path entirely.** `.runtime/sentinel_db.json` persists settings and small control state only.
- Backpressure: at 80% queue depth, drop lowest-priority metrics and increment a `sentinel_ingest_dropped_total` counter. Never block the HTTP handler; never grow unbounded.
- Keep `getMetrics()`'s existing signature and response shape (C3), but serve it from `metric_1m` when the requested range exceeds 6 hours, and from raw `metric` otherwise.
- Preserve the existing degradation tracking (`getPersistenceStatus`) — it already feeds the health payload.

### T2.3 — Cardinality guard
2,000 hosts × unbounded label combinations will kill the database. Add a guard in the normalizer: cap distinct `entity_id × metric_name` series (default 200,000), log and drop beyond it, expose the current count on the ingest-health endpoint.

### T2.4 — Collector fan-out
`metrics_collection/collector_coordinator.js` currently loops environments with sequential `await` on a `setInterval` in the API process.
- Move collection behind `SENTINEL_ROLE=collector`.
- Shard targets across N collector instances by `hash(entity_id) % N`, configured by `SENTINEL_SHARD_INDEX` / `SENTINEL_SHARD_TOTAL`.
- Use the existing `metrics_collection/concurrency_limiter.js` for in-shard parallelism (start at 50).
- Add **per-target circuit breakers** — with 2,000 targets, hammering dead endpoints every 10s is self-inflicted load. Open after 5 consecutive failures, half-open retry with exponential backoff to a 5-minute ceiling.
- Add **scheduling jitter** so a restart does not stampede every target at once.

### T2.5 — Right-size the WebSocket
`backend/server.js` broadcasts full state to every client on every change, plus a 5s `metrics_tick` that recomputes `calculateHealthState()` per tick. At fleet scale this dominates CPU.
- Compute health **once** per tick, reuse for all clients.
- Send deltas, not full state, after the initial `init` frame.
- Let clients subscribe to a scope (`{ view, entity_ids[] }`); do not push fleet-wide metric detail to a client looking at one app.
- Keep the `init` / `state` / `metrics_tick` / `log` frame types and payload shapes intact (C3).

### T2.6 — Ingest health endpoint
`GET /api/v2/ingest/health` → queue depth, flush latency p50/p95, rows/sec, dropped counters, active series count, per-collector shard status, circuit-breaker states. Feeds the new Pipeline Ops View (§14.4).

**Phase 2 exit criteria:** a load harness (`tests/load_ingest.js`, replacing the credential-cache-only `tests/load_test_200.js`) sustains **1,000 rows/sec for 10 minutes** with p95 ingest ack < 150ms, steady memory < 2GB, and zero dropped rows. `GET /api/metrics` for one entity over 24h returns in < 400ms p95.

---

## 9. Phase 2b — Collector truthfulness

**Goal:** make the collectors actually collect. This is the phase that decides whether "replace the placeholder URLs and the app shows real values" is true.

### What the sweep found

46 `Math.random()` calls across 25 real collectors, in three tiers:

**Tier 1 — hardcoded constants presented as live infrastructure state.** `avi_collector.js`:

```js
virtual_service_health_score: isOutage ? 18 : 98,
total_pools: 13,
total_pool_members: 48,
pool_members_up: isOutage ? 12 : 46,
```

Literals, returned in production regardless of what AVI reports. `k8s_collector.js` is the same (`totalNodes = 12`). **15 of 26 collectors have no environment guard at all** — no `isProd`, no DATA_UNAVAILABLE path:

`avi`, `database`, `docker`, `k8s`, `linux`, `nas`, `network`, `node_exporter`, `s3`, `sso`, `windows`, `bitbucket_external`, `mcp`, `otkr`, `performance_center`

That is the entire infrastructure tier — precisely the layer the 40-hour investigation must trust.

**Tier 2 — real fetch used only as a liveness gate; numbers come from the YAML baseline plus jitter.** `sonarqube_collector.js`, one of the *better* ones:

```js
const responseTime = healthResult.success
  ? base.responseTime + Math.floor((Math.random() - 0.5) * 5)
  : (isProd ? null : base.responseTime + ...);
```

Even on the **success** path, `responseTime` is the YAML baseline plus jitter — the actual request duration is measured and discarded. `qualityGatesPassed` and `analysisQueue` likewise come from `metrics_baseline`; the real API response is never parsed for them. Only `systemStatus` is genuine. Same pattern in `jenkins` (7 base-fallbacks), `github` (6), `argocd`, `argoworkflows`, `artifactory`, `bitbucket`, `fortify`, `nexusiq`, `teamcity`.

**Tier 3 — genuine jitter on genuinely fetched values.** Rare.

**Frontend — 2 real fabrication sites:**
- `MetricsDetail.jsx:229,298` — builds `fallbackPoints` from a hardcoded `baseVal` per metric type plus noise and renders it as chart data.
- `AiLogPerformance.jsx` — random `scanThroughput`, hardcoded `accuracy: 99.9`, per-environment hardcoded blocks.

Benign and **not** to be changed: `Sparkline.jsx:68` (SVG gradient id — migrate to `useId()`), `CommandCenter.jsx:151,364` (`key={x.id || Math.random()}` — breaks React reconciliation, fix to a stable key), and the `setInterval` polling in `PowerBiDashboard.jsx` / `RcaDashboard.jsx` (legitimate refresh).

### T2b.1 — The collector contract

Every collector returns:

```js
{
  status: 'OK' | 'DATA_UNAVAILABLE' | 'AUTH_FAILED' | 'DISABLED',
  metrics: { <name>: number | null },
  source: 'live' | 'none',
  observedAt: ISO8601,
  error: string | null
}
```

Rules, enforced by a new lint rule alongside `lint:constants`:

1. **No `Math.random()` anywhere under `metrics_collection/real/` or `logs_collection/real/`.** Zero exceptions. Jitter belongs only in the `simulation/` trees.
2. **No numeric literal may reach a returned metric value.** Every number is parsed from a response or is `null`.
3. `metrics_baseline` in YAML is for **threshold comparison and demo synthesis only** — never a returned production value.
4. Measure real latency with `performance.now()` around the fetch. Never synthesize `responseTime`.

### T2b.2 — Rewrite the 26 collectors

Per collector: identify the real API endpoint and response shape, parse the metrics the dashboard displays, map response fields to metric names, return `null` plus a reason for anything the API does not expose. Do not invent a value because the dashboard has a tile for it — **an empty tile is a correct answer**.

Order by dependency for the correlation engine: infrastructure first (`avi`, `k8s`, `nas`, `network`, `database`, `storage`), since Phase 4 blames infrastructure and cannot do so from constants.

Where an API genuinely does not expose a metric, remove the tile rather than filling it.

### T2b.3 — Mirror into the simulation tree

Keep `simulation/` exports signature-identical. This is where baselines and jitter legitimately live.

### T2b.4 — Frontend fabrication removal

`MetricsDetail.jsx` and `AiLogPerformance.jsx` render an empty state instead of synthesized series. Reuse the existing "Value Not Available" treatment already present in `CommandCenter.jsx` — no new design.

### T2b.5 — Config preflight checker

A command plus a small View that walks every configured endpoint and reports **reachable / auth-OK / unreachable** per target, with the failure reason. Run it before anyone trusts the dashboard.

This is what actually delivers the config-only goal: the operator pastes real values, runs preflight, and sees green or a precise per-target reason.

### T2b.6 — Fail-fast config validation at boot

`yamlConfig.validateConfig()` exists but is **never called at startup** — it runs only from a save path and from a test. Call it in the boot sequence and refuse to start on a validation error. Purge the 6 hardcoded URL fallbacks and the `'STG_PG_SECURE_PASSWORD_VAL'` / `'STG_JENKINS_TOKEN_VAL'` literals so unconfigured means *loudly unconfigured*, never a silent fake value.

**Phase exit:** with placeholder config, every tile reads DATA_UNAVAILABLE and preflight reports every target unreachable. With real config, preflight is green and every displayed number traces to a parsed API response. A grep for `Math.random` under `*/real/` returns zero.

---

## 10. Phase 3 — Log pipeline and Log Explorer

**Goal:** replace the OpenSearch dependency with a self-contained pipeline, and deliver the in-app log search the requirement asks for. Today `logs_collection/real/fluentd/fluentd_log_collector.js` reads one file with `readFileSync(...).slice(-5)` — last five lines, no offset tracking, re-reading the same content every tick.

### T3.1 — Ingest endpoint
`POST /v1/logs` accepting both Fluentd `http` output JSON and OTLP/logs. Same batching, backpressure and rate-limiting treatment as the metric path. This is the primary route (C7: fluentd is installable on the owned estate).

### T3.2 — Fix the file tailer
Rewrite the fluentd collector as a real tailer for NAS-mounted logs: persistent byte-offset checkpoints per file in `.runtime/log_offsets.json`, inode-change detection for rotation, multi-path and glob support from each app's YAML `logs:` block. Mirror into `logs_collection/simulation/` (gotcha #3).

### T3.3 — Parsing and fingerprinting
Per-app pattern packs in YAML (`logs.patterns`) extracting `level`, `ts`, `logger`, `message` and app-specific fields. Compute a **fingerprint** per line — the message with numbers, UUIDs, paths and hostnames masked — which powers novelty detection in Phase 4.

### T3.4 — Log storage and retention tiering
The requirement is explicit: weeks locally, 2 weeks in the DB, the rest to S3.

```sql
CREATE TABLE log_event (
  ts          TIMESTAMPTZ NOT NULL,
  entity_id   TEXT,
  app_id      TEXT,
  environment TEXT NOT NULL,
  level       TEXT,
  logger      TEXT,
  message     TEXT NOT NULL,
  fields      JSONB,
  fingerprint TEXT
);
SELECT create_hypertable('log_event', 'ts', chunk_time_interval => INTERVAL '6 hours');
CREATE INDEX ON log_event USING brin (ts);
CREATE INDEX ON log_event (app_id, level, ts DESC);
CREATE INDEX ON log_event USING gin (to_tsvector('simple', message));
SELECT add_compression_policy('log_event', INTERVAL '2 days');
SELECT add_retention_policy('log_event', INTERVAL '14 days');
```

- **Local:** keep the existing `logger/logger.js` rotation (500MB / daily / 30 files / gzip) — it already works.
- **S3:** a daily archival job (`logs_collection/archival/s3_archiver.js`) writes gzipped NDJSON partitioned `env/app/date/` before the 14-day retention drops the chunk. Credentials via the CyberArk provider, never `.env`. Note that `metrics_collection/real/infrastructure/s3_collector.js` measures S3 *latency* — it does not ship anything; this is new code.

Postgres full-text search is the deliberate choice over OpenSearch here: the team is already fighting unassigned shards and storage limits on a k8s-hosted OpenSearch, and 14 days of parsed logs with a GIN index is well within Postgres's comfort zone. Do not reintroduce OpenSearch.

### T3.5 — Search API
- `GET /api/v2/logs/search` — `q`, `from`, `to`, `entity_id`, `app_id`, `level`, `limit`, `cursor`. Keyset pagination on `(ts, id)`, never `OFFSET`.
- `GET /api/v2/logs/histogram` — bucketed counts for the timeline chart.
- `GET /api/v2/logs/facets` — top apps / levels / fingerprints for the current filter.
- Every query **must** be time-bounded; reject unbounded scans with a 400.

### T3.6 — Log Explorer View (new)
`frontend/src/components/logs/LogExplorerView.jsx` — a **new tab**, registered in the existing tab array in `frontend/src/App.jsx`. Reuses existing CSS classes and the existing `CustomChart` component for the histogram. Layout mirrors the familiar pattern: time-range control, query bar, histogram, facet sidebar, virtualized result list, row expansion for full JSON, live tail toggle.

No existing view changes. `frontend/src/components/analytics/AiLogPerformance.jsx` keeps its current design; only its data source moves from hardcoded stats to the real API.

**Phase 3 exit criteria:** 5,000 lines/sec sustained ingest; free-text search across 14 days returns p95 < 2s; an archived day is readable back from S3; tailer restart does not duplicate or drop lines.

---

## 11. Phase 3b — Log shipper rollout

**Goal:** get logs off 2,000 hosts. `deployments/` currently automates **OTel collector and node_exporter only** — there is no fluentd or fluent-bit automation anywhere in the repo.

### T3b.1 — Ship through existing config management

Package Fluent Bit and deliver it via the channel that already owns those hosts (SCCM, Ansible Tower, whatever the estate uses), as a versioned package with a pinned config. **Sentinel renders configs; it never pushes them.** Building a second, unaudited config-management system across 2,000 hosts will not pass review.

Mirror the three existing OTel patterns: Ansible for Linux, PowerShell/MSI for Windows, DaemonSet for k8s.

### T3b.2 — Config generation from inventory

Per-host configs (tags, paths, destination) are generated from the Phase 1 entity model, never hand-maintained.

### T3b.3 — Agent heartbeat

Agent version and last-seen become inventory attributes. **A silent shipper looks exactly like a healthy application** — this is a monitoring gap, not an inventory nicety.

### T3b.4 — Shipper authentication

`/v1/logs` and `/v1/metrics` require mTLS or a shipper token bound to an environment. This also supplies the ingest environment tag for T1c.4.

### T3b.5 — Interim path

Until the rollout lands, the existing NAS-tail approach (T3.2) is a legitimate interim — it is what the current architecture assumes and it lets Phase 3 deliver while the rollout negotiation proceeds. Its limits are real though: one consolidated file is a throughput bottleneck and loses per-host attribution.

### T3b.6 — Redact at the shipper

Per the data-residency requirement: Fluent Bit filters strip tokens, keys, PANs and emails **before the line leaves the host**. Classification tagging and region-pinned storage follow — EMEA logs stay in EMEA, APAC in APAC. Correlation ships derived **events** across regions, never raw log bodies.

This costs nothing analytically: the correlation engine only ever needs the event ("storage latency breach on vol-03"), not the log body.

---

## 12. Phase 4 — Event bus and correlation engine

**Goal:** the headline requirement — collapse the 40-hour "is it the app or the infra?" investigation. This is currently 1,486 lines of hardcoded mock data in `frontend/src/data/correlationData.js` feeding ~1,700 lines of correlation UI, with no backend at all.

### The core insight
The 40 hours is spent proving that an app symptom is really a shared-infra cause. The signal that collapses it is **fan-out**: when fourteen unrelated applications degrade simultaneously and the only thing they share is `trident-nfs-vol-03`, that is the answer, and it is computable in seconds once the topology graph from Phase 1 exists. Build the engine around fan-out detection first; everything else is supporting evidence.

### T4.1 — Normalized event store

```sql
CREATE TABLE event (
  event_id    UUID PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,
  entity_id   TEXT,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  payload     JSONB,
  environment TEXT NOT NULL,
  source      TEXT NOT NULL
);
SELECT create_hypertable('event', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX ON event (entity_id, ts DESC);
CREATE INDEX ON event (kind, environment, ts DESC);
```

`kind` values: `metric_anomaly`, `log_anomaly`, `deploy`, `argocd_sync`, `config_drift`, `avi_pool_change`, `k8s_event`, `storage_event`, `network_change`, `cert_event`, `change_ticket`, `incident`.

Match these to the track ids already present in `correlationData.js` so the existing timeline UI binds unchanged.

### T4.2 — Event producers
- **Metric anomaly** — rolling baseline per `entity_id × metric_name` (EWMA + MAD, 7-day window from `metric_1h`), emit on sustained deviation. Replaces fixed thresholds, which do not generalize across 2,000 heterogeneous hosts.
- **Log anomaly** — three detectors: known pattern match (per-app rule packs), **novelty** (fingerprint unseen in 7 days), and **rate spike** (fingerprint volume vs baseline). This replaces the four hardcoded regexes in `ai_analysis/real_analyzer.js`, which only ever fire for four fixed components.
- **ArgoCD sync / deploy** — poll the ArgoCD API for sync events.
- **Config drift** — periodic compare of live state against the declared YAML; emit on divergence.
- **AVI pool change** — pool member up/down/flip from the AVI API.
- **K8s events** — node pressure, evictions, `OOMKilled`, probe failures, from the k8s API.
- **Storage** — NFS/Trident latency and capacity breaches. Call this out explicitly: it is one of the named 40-hour root causes.
- **Change tickets** — approved ServiceNow CHGs in the window.

### T4.3 — The correlator
New package `correlation/` (register in `scripts/setup_symlinks.js` as `@sentinel/correlation`).

When a symptom event fires on an app entity:
1. Walk `entity_edge` **downward** from the app: app → controller → host → k8s node → storage / AVI / network. Depth limit 5.
2. Query `event` within the window (default −30m to +5m, configurable).
3. For each candidate infra entity, compute:
   - **fan-out** — how many *other* app entities depending on this same infra entity are also symptomatic in the window. The dominant signal.
   - **temporal precedence** — does the infra event precede the app symptom?
   - **graph proximity** — inverse hop distance.
   - **change proximity** — a deploy, drift or CHG inside the window.
4. Score and rank:

```
score = 0.40 * fanout_normalized
      + 0.25 * temporal_precedence
      + 0.20 * (1 / graph_distance)
      + 0.15 * change_proximity
```
Weights live in `config/correlation.yaml` so they can be tuned without a deploy. Emit a hypothesis above 0.5; mark `high_confidence` above 0.75.

```sql
CREATE TABLE rca_hypothesis (
  hypothesis_id    UUID PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_event_id UUID NOT NULL REFERENCES event(event_id),
  suspect_entity_id TEXT NOT NULL,
  confidence       REAL NOT NULL,
  blast_radius     INT NOT NULL,
  rationale        JSONB NOT NULL,   -- ordered evidence chain, each item cites an event_id
  environment      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'  -- open|confirmed|rejected|superseded
);
```

`rationale` must be a human-readable evidence chain citing real event ids — an SRE has to be able to audit *why* the system blamed the storage volume. Never present a hypothesis without its evidence.

### T4.4 — Operator feedback loop
`POST /api/v2/rca/hypotheses/:id/verdict` records confirmed/rejected. Store it. This is the training data for later weight tuning — without it the scoring never improves.

### T4.5 — Replace the mock data source
Delete `frontend/src/data/correlationData.js` and replace it with an API client exposing **the identical exported shape** (`NORMALIZED_TIMELINE_EVENTS` and friends) backed by `/api/v2/events` and `/api/v2/rca/hypotheses`. The existing correlation components — `UnifiedCorrelationTimeline.jsx`, `DriftRcaCorrelationFeed.jsx`, `EntityExplorerView.jsx`, `EntityDrillDownPanel.jsx`, `GlobalEntitySearch.jsx` — must render **without modification**. If a component needs a field the API does not yet produce, add the field to the API; do not edit the component.

### T4.6 — Retire the canned RCA text
`ai_analysis/rca_analytics_engine.js` is a lookup table of pre-written root-cause sentences per app (`demoRootCause`, `stgRootCause`). Keep it **only** as the `demo` environment data source; `prod` and `staging` read from `rca_hypothesis`. If no hypothesis exists, return empty — do not fall back to canned text (C4).

### T4.7 — Repoint predictive analysis
`ai_analysis/predictive.js` has real linear regression but calls `db.getMetrics(component, 100)` without an environment and is starved by the 200-row buffer. Repoint it at `metric_1m`, make it environment-aware, and widen the window.

**Phase 4 exit criteria:** a replay harness (`tests/correlation_replay.test.js`) injects a synthetic storage-degradation scenario affecting 14 apps on one volume; the engine produces a hypothesis naming that volume with confidence > 0.75 and blast radius 14, **within 60 seconds** of the trigger, with an evidence chain citing real event ids. The existing correlation UI renders it with zero component changes.

---

## 13. Phase 5 — Source hardening

### T5.1 — Dynatrace 30-second token
`resolveApiToken()` in `metrics_collection/real/dynatrace/dynatrace_collector.js` goes through the CyberArk provider, whose cache TTL is **15 minutes** (`credential_provider.js`, `CACHE_TTL_MS`). With a 30-second token, roughly 29 of every 30 minutes uses an expired credential.

Build `metrics_collection/real/dynatrace/token_provider.js`:
- mint per request; cache with TTL = `min(token_ttl - 5s, 25s)`;
- single-flight lock so concurrent collectors trigger one mint, not fifty;
- refresh-and-retry-once on `401`;
- never route this through the 15-minute credential cache. Add a `ttlMs` override to `credentialProvider.getCredential()` so short-lived credentials are a first-class case.

### T5.2 — Dynatrace metric-name drift
Metric selectors are hardcoded, so a rename silently yields zeros — exactly the fragility the requirement calls out. Add `config/dynatrace_metric_aliases.yaml` mapping each canonical Sentinel metric to an ordered candidate list. On startup and daily, probe `/api/v2/metrics/descriptors` to resolve which candidates exist. When none resolve, **raise a `DATA_UNAVAILABLE` alert naming the metric** — never silently report zero.

### T5.3 — Make Dynatrace fully optional
Put it behind a `TelemetrySource` interface alongside OTLP and node_exporter (`telemetry_provider_selector.js` already has the profile concept). Decommissioning Dynatrace must be a config edit, nothing more (C8).

### T5.4 — Real expiry radar
`backend/config/expiryEngine.js` is eight hardcoded records with frozen `daysLeft` integers that never count down, and no TLS probing anywhere in the codebase.

Rewrite as a scheduled job:
- **TLS** — `tls.connect()` per `lifecycle.certificates[].probe` target, read `notAfter` off the peer certificate. Covers each app's refweb URL and AVI VIP.
- **refweb URL expiry** and **license expiry** — from the YAML `lifecycle:` block (T1.4).
- **CyberArk object expiry** — from CCP metadata where exposed.
- **K8s ServiceAccount tokens** — from the k8s API.

```sql
CREATE TABLE expiry_item (
  item_id      TEXT PRIMARY KEY,
  entity_id    TEXT,
  kind         TEXT NOT NULL,   -- tls_cert|license|refweb_url|cyberark_object|k8s_sa_token
  target       TEXT NOT NULL,
  issuer       TEXT,
  not_after    TIMESTAMPTZ,
  last_checked TIMESTAMPTZ,
  last_error   TEXT,
  warning_days INT NOT NULL DEFAULT 30,
  critical_days INT NOT NULL DEFAULT 7,
  auto_renew   TEXT
);
```

Compute `daysLeft` at read time from `not_after`. Keep `getAllExpiryItems()` / `getExpirySummary()` response shapes so the existing expiry UI in `SreEnterpriseControl.jsx` is untouched (C3). Emit `cert_event` events into the Phase 4 bus so renewals appear on the correlation timeline — an expired certificate is a classic silent root cause.

### T5.5 — URL-only collectors for unowned systems
Per C6, several targets expose only a URL. Implement a generic `url_probe_collector` — TLS validity, HTTP status, latency, optional content assertion — and use it for Aquasec and anything else without an agent or a rich API.

---

## 14. New Views

All four are **new tabs** registered in the existing tab array in `frontend/src/App.jsx`, using existing nav markup and existing CSS classes from `App.css`. No existing view is restyled or relaid out (C1, C2).

### 10.1 Fleet & Inventory Explorer
`frontend/src/components/fleet/FleetExplorerView.jsx`
Hierarchical browse of the ~2,000 entities: app → OC → controller → agent/host, filterable by region, kind, environment, status. Health rolled up from children. Shows discovered-vs-expected agent counts. Surfaces stale entities. This is where region filtering lives, so existing views keep their current behaviour.

### 10.2 Log Explorer
`frontend/src/components/logs/LogExplorerView.jsx` — §T3.6.

### 10.3 Blast Radius
`frontend/src/components/correlation/BlastRadiusView.jsx`
The 40-hour feature made visible: for a selected incident, the suspect infra entity, the dependency path from symptom to cause, every affected app, the evidence chain with timestamps, and confirm/reject controls feeding T4.4. Reuses the existing timeline and drill-down components' visual language.

### 10.4 Pipeline Ops
`frontend/src/components/ops/PipelineOpsView.jsx`
Operator view over `/api/v2/ingest/health`: queue depth, flush latency, rows/sec, drop counters, active series vs cardinality cap, collector shard status, circuit-breaker states, tailer offsets, S3 archival status. At this scale the pipeline needs its own monitoring.

---

## 15. API additions

All new, all additive. Existing endpoints keep their exact response shapes and become adapters over the new stores.

```
GET  /api/v2/entities?kind=&region=&app_id=&env=&status=&q=&cursor=
GET  /api/v2/entities/:entity_id
GET  /api/v2/topology?root=&depth=&direction=down|up
GET  /api/v2/fleet/summary?env=&region=

POST /v1/logs
GET  /api/v2/logs/search
GET  /api/v2/logs/histogram
GET  /api/v2/logs/facets

GET  /api/v2/events?from=&to=&kind=&entity_id=&env=
GET  /api/v2/rca/hypotheses?env=&status=&from=&to=
GET  /api/v2/rca/hypotheses/:id
POST /api/v2/rca/hypotheses/:id/verdict
GET  /api/v2/rca/blast-radius?hypothesis_id=

GET  /api/v2/expiry
GET  /api/v2/ingest/health
```

Every list endpoint is keyset-paginated and time-bounded. Every one requires a valid JWT after T0.5.

---

## 16. Test plan

Add to the sequential `test` script in `package.json`. Keep the plain-`node` + `assert` style (gotcha #8).

| Test | Asserts |
|---|---|
| `tests/recovery_four_eyes.test.js` | auto-trigger queues for approval; two distinct approvers required (T0.1) |
| `tests/alert_env_tagging.test.js` | alerts land in the right environment (T0.2) |
| `tests/auth_lockdown.test.js` *(extend)* | anonymous mutation 401; role matrix enforced (T0.5) |
| `tests/inventory_discovery.test.js` | OTLP push auto-registers a host and links it to its app (T1.3) |
| `tests/entity_hierarchy.test.js` | OC → controller → agent resolves; expected-vs-discovered counts (T1.4) |
| `tests/load_ingest.js` | 1,000 rows/sec for 10 min, p95 < 150ms, no drops (Phase 2) |
| `tests/cardinality_guard.test.js` | series cap enforced, counter increments (T2.3) |
| `tests/log_tailer.test.js` | offset checkpointing survives restart; rotation handled; no dupes (T3.2) |
| `tests/log_search.test.js` | search correctness and p95 latency over 14 days (T3.5) |
| `tests/log_archival.test.js` | S3 partition written and read back (T3.4) |
| `tests/correlation_replay.test.js` | 14-app storage scenario → correct suspect, confidence > 0.75, < 60s (Phase 4) |
| `tests/dynatrace_token.test.js` | token re-minted inside 30s; single-flight; 401 retry (T5.1) |
| `tests/dynatrace_drift.test.js` | unresolvable selector raises DATA_UNAVAILABLE, not zero (T5.2) |
| `tests/expiry_probe.test.js` | real TLS `notAfter` read; daysLeft computed at read time (T5.4) |

Keep all existing tests green throughout — especially the three data-segregation tests, which encode constraint C4.

---

## 17. Sequencing

### Track A — code

| Phase | Delivers | Blocks |
|---|---|---|
| **0** | Correctness + security (20 items, several exploitable today) | start here |
| **1** | Entity model, inventory, topology | 1b, 2, 3, 4 |
| **1b** | Collector authentication | 2b |
| **1c** | Per-user environment isolation | 2, 2b |
| **2** | Ingest rewrite, TimescaleDB, collector sharding | 3, 4 |
| **2b** | Collector truthfulness — rewrite 26 collectors | 4 |
| **3** | Log pipeline, Log Explorer View | 4 |
| **3b** | Log shipper rollout | — |
| **4** | Event bus, correlation engine, Blast Radius View | — |
| **5** | Dynatrace hardening, expiry radar, URL probes | — |

Phases 1, 1b, 1c and 2 are the critical path and are strictly serial.

**Phase 2b is the phase that decides whether the config-only goal is met.** Without it, correct URLs and working authentication still produce YAML baselines plus jitter. Phase 4 also depends on it: the correlation engine blames infrastructure, and it cannot do that from hardcoded constants.

Phases 3b and 5 are independent and can run in parallel with a second pair of hands.

### Track B — assurance (start booking now; these queue for weeks)

- Independent penetration test. This plan is a code review, not a substitute.
- SAST and DAST in the pipeline — the estate already owns Fortify; Sentinel should be scanned by it.
- Threat model / STRIDE, with a signed-off security architecture review.
- Secrets scanning across the repo **and its history**.
- Open-source licence review of the dependency tree.

### Track C — operational acceptance (usually the real critical path to a date)

- Backup and **tested restore** of TimescaleDB, config and audit store, with stated RPO/RTO.
- DR posture: Sentinel monitors production, so define what happens to Sentinel *during* a DR event.
- Capacity model: disk growth per day at 2,000 hosts, IOPS, connection pool sizing.
- Failure-mode testing — Postgres down, CyberArk down, NAS unmounted, disk full — and a documented graceful-degradation matrix.
- CI/CD pipeline for Sentinel itself. There is currently **none**: no `.github/`, no root pipeline; `deployments/Jenkinsfile` builds agent rollout, not the app.
- Branch protection and mandatory review. Work is currently committed directly to `main`.
- SBOM generation, artifact signing, release tagging, **documented rollback procedure**.
- A dev → SIT → UAT → prod promotion path.
- Runbook and operations manual; L1/L2/L3 support model; an on-call rota **for Sentinel itself**.
- Named application owner and technical owner — the bus factor is currently 1.
- CMDB registration, criticality tier, SLA/OLA; NOC operator training.
- Data classification and DPIA, given the PII exposure.
- Records retention schedule mapped to policy (SOX typically 7 years for change records).
- RBAC matrix signed off by control owners; segregation-of-duties analysis on four-eyes.
- Self-observability: Sentinel's own metrics and logs exported *elsewhere*, plus an **external dead-man's switch**. A monitoring platform that fails silently is worse than none.

### Testing gaps to close alongside

- Zero frontend tests exist.
- No contract or integration tests against the real tool APIs.
- No coverage measurement and no CI gate.
- `tests/load_test_200.js` measures a credential cache, not ingest — replace it.

---

## 18. Definition of done

1. All four new Views ship, with **zero diffs** to existing view layout or styling.
2. Existing API response shapes unchanged; frontend components outside the four new directories compile without modification.
3. **Every displayed number traces to a parsed API response.** `grep -rn "Math.random" metrics_collection/real/ logs_collection/real/` returns nothing.
4. With placeholder config, every tile reads DATA_UNAVAILABLE and preflight reports every target unreachable. With real config, preflight is green.
5. Two sessions on different environments hold their selections indefinitely under active collection; a third selecting DEMO changes neither; OTLP is tagged from agent attributes throughout.
6. Sustained 1,000 metric rows/sec and 5,000 log lines/sec, verified by harness.
7. The 14-app storage scenario produces a correct, evidence-backed hypothesis in under 60 seconds.
8. Log retention tiering verified end to end: local → DB (14 days) → S3, with redaction applied at the shipper and regions pinned.
9. Dynatrace can be disabled by config alone, with no code change and no broken view.
10. Anonymous mutating requests are rejected; rate limiters survive `X-Forwarded-For` rotation; four-eyes approval cannot be bypassed.
11. No fabricated audit or SSO records exist in any code path.
12. `npm test` and `npm run lint` green, running in CI, with the segregation tests exercising the **persistence** layer.

---

## 19. The one engineering principle behind most of this

Across every finding — fabricated health, invented latency, seeded audit records, simulated pull requests, canned root causes, hardcoded infrastructure constants — the pattern is identical:

> **The system is written to always return something plausible rather than admit it does not know.**

That is the opposite of what an observability platform is for, and in a regulated environment it is the specific failure mode that ends careers. An empty tile is a correct answer. A plausible number that never touched the real system is not.

Most of the remediation is deletion, which is good news for effort. But it needs to be an explicit engineering principle enforced by lint and review, not a one-time list of patches — otherwise it grows back.

---

## 20. Documentation corrections

`README.md`, `docs/ARCHITECTURE.md` and `docs/PRODUCTION_GUIDE.md` currently assert controls that do not exist in code. Left uncorrected they will be handed to an auditor as evidence. Correct each of these:

| Claim | Reality |
|---|---|
| "Strict Data Segregation" as the headline control | Not implemented in the Postgres path (T0.18) |
| "12/12 PASSED" QA matrix | `npm test` runs 11 files; `load_test_200.js` is listed but not in the script |
| OTel agent config shows a Sentinel bearer token | `/v1/metrics` is exempted from auth; the token is never validated |
| db.js cap is "200-item per environment" | It is 200 rows **globally**; staging evicts prod |
| SECURITY.md: CCP cache TTL 300s | Code is 900s; neither suits the 30-second Dynatrace token |
| "Zero endpoint URLs are hardcoded" | 6 hardcoded URL fallbacks plus 2 credential literals |
| "Immutable Audit Log" | A gzip-rotating file with 30-file retention |
| Retention 60 days raw (guide) | vs "7-Day Partitioned Hypertables" (architecture). Pick 7 days raw plus rollups |
| "Winston centralized logging" | It is `rotating-file-stream` |
| "Fluentd, Splunk & Elasticsearch collectors" | Only fluentd exists |
| "error classes" in `shared/` | Not present |
| Module paths such as `real/app_collector.js` | Actual path is `real/applications/app_collector.js` |

---

## 21. Open decisions the product owner must make

These block specific tasks. Record the answer in this file when made.

| # | Decision | Blocks | Default if unanswered |
|---|---|---|---|
| D1 | For applications where the **AVI itself** enforces SSO before traffic reaches the app, can the platform team grant a **source-IP exemption** for the Sentinel host? | T1b.1 scheme choice | Assume no; implement Selenium-derived cookie-session reuse, which is materially more fragile |
| D2 | Is **TimescaleDB** available and approved in the estate, or is it plain PostgreSQL? | T2.1 | Plain Postgres with `PARTITION BY RANGE` and cron rollups |
| D3 | Which config-management channel already owns the 2,000 hosts (SCCM / Ansible Tower / other)? | T3b.1 | Ship the NAS-tail interim only (T3b.5) |
| D4 | Do logs need to be **region-pinned** for legal residency, or is a single central store acceptable? | T3b.6, Phase 3 storage | Assume region-pinned; it is the safer default and cheap to relax later |
| D5 | Raw metric retention: **7 days** (this plan) or **60 days** (`PRODUCTION_GUIDE.md`)? At 2,000 hosts the difference is large. | T2.1 retention policy | 7 days raw plus 1m/1h rollups |
| D6 | Is the **environment switcher** needed in prod at all once deployments are separated (T1c.6)? | T1c scope | Keep it, session-scoped and read-only in prod |
| D7 | Rota upload: keep Excel (needs `exceljs`) or **accept CSV only**? | T0.19 | CSV only — smaller attack surface, and a rota is tabular text |

---

## 22. Coverage and limits of this review

State this plainly to any review board that receives the plan.

**Method:** static reading of source and documentation. The application was **not executed**. No dynamic testing, no load testing, no fuzzing, no penetration testing, and no live dependency audit was performed. One runtime check was run: a Node module-load test on `bitbucket_pr_service.js`.

**Code coverage of the review:**

| Area | Reviewed |
|---|---|
| `backend/` | ~95% |
| `database/`, `remediation/`, `shared/`, `logger/` | ~90% |
| `ai_analysis/` | ~60% |
| Collectors | ~30% read in full; 100% swept by pattern |
| Frontend | ~10% read; 100% swept by pattern |
| Tests | 2 of 11 read |
| `scripts/`, `deployments/` | skimmed |

**What that means:** the Phase 2b collector findings come from a pattern sweep across all files plus full reads of a representative sample. Expect additional instances of the same class when each collector is opened for rewrite. The frontend is the least-reviewed area; treat its fabrication list as a floor, not a ceiling.

**This review does not substitute for an independent penetration test** (Track B), and finding nothing in an unreviewed area is not evidence of absence.

---

## 23. Local validation harness — launching and proving the app

Every phase must be validated by **running the application**, not only by unit tests. This section defines the harness. Build it during Phase 0 and extend it each phase.

### 23.1 What a first launch does today (verified)

Booting `node backend/server.js` with only `SENTINEL_JWT_SECRET` set produces:

```
[LOGGER] Could not create target NAS mount (d:\production_shares\nas_logs), falling back to .runtime/nas_logs
[DB] Local write-behind cache loaded. Metrics count: 200, Alerts: 0
[SYSTEM] Starting Observability coordinator in [REAL] mode.
[SYSTEM] ... Backend API running on http://0.0.0.0:3001
[CRED] No registry entry for database/db — skipping CyberArk, trying fallback.
[REAL COLLECTOR] Fetching Jenkins builds queue from: https://jenkins-prod.internal.corp/job
[SELENIUM ENGINE] Spawning python browser check for URL: https://jenkins-prod.internal.corp/job
...repeating every 10s
```

Five things to note, because each is a validation trap:

1. **The app serves on :3001 and the SPA loads.** Launch validation is viable today.
2. **`Metrics count: 200` — `.runtime/sentinel_db.json` already contains stale cached data.** The UI will render it and look alive. **Always delete `.runtime/sentinel_db.json` before a validation run**, or you will validate against yesterday's fabricated numbers.
3. **DNS failures against `*.internal.corp` are swallowed silently.** Nothing is logged when a collector cannot reach its target — that silence is the fabrication path. After Phase 2b, every one of these must produce a visible DATA_UNAVAILABLE with a reason.
4. **`[SELENIUM ENGINE] Spawning python browser check` repeats every 10 seconds for several URLs, unbounded.** This is T0.15 observable live: no spawn timeout, no concurrency cap. On a host with Python but no Selenium these processes hang and accumulate.
5. **It collects `prod` by default** (`config/global.yaml` has `environment: "production"`), while some targets resolve to `stg` URLs. Do not assume the environment is staging during validation.

### 23.2 Harness components to build

Create under `tools/validation/` (not shipped to production):

**a. `docker-compose.validation.yml`** — TimescaleDB (or Postgres) with the Phase 2 schema applied. No external dependency, disposable, reset between runs.

**b. `fixture-upstream/` — a mock upstream server.** This is the single most important piece, because it is the only way to prove the config-only contract without production access.

A small Express app that impersonates the real tool APIs with **known, fixed values**:

```
GET  /jenkins/api/json          -> { queue: [...12 items], executors: [...8] }
GET  /sonarqube/api/system/status -> { status: "UP" }
GET  /artifactory/api/system/ping -> "OK"
GET  /avi/api/v1/telemetry      -> { metrics: { connections: 1337, ... } }
...one route per collector
```

Then point `config/global.yaml` at `http://localhost:9099/...` and assert the dashboard displays **1337 connections, 12 queued builds, 8 executors** — the fixture's values, not the YAML baselines. That is the proof that the collector parses rather than invents.

Add failure modes to the fixture, toggled by query flag or path: `/slow` (delays past timeout), `/401` (auth failure), `/302-idp` (SAML redirect), `/500`, and connection-refused by stopping a route. Each must produce its correct distinct state.

**c. `preflight` CLI** (from T2b.5) — reachable / auth-OK / unreachable per target.

**d. `fixture-otlp-agent/`** — a script that POSTs synthetic OTLP payloads to `/v1/metrics` at a configurable rate, with settable `host.name` / `service.name` / environment resource attributes. Used for Phase 1 auto-registration, Phase 1c ingest tagging, and Phase 2 load.

### 23.3 Standard validation run

```
1. docker compose -f tools/validation/docker-compose.validation.yml up -d
2. rm -f .runtime/sentinel_db.json .runtime/log_offsets.json
3. npm run migrate
4. start fixture-upstream on :9099
5. SENTINEL_JWT_SECRET=<64 hex> npm start
6. npm run build  (or npm run dev for the Vite HMR frontend)
7. open http://localhost:3001
```

Reset steps 1–2 between phases. A validation run that reuses `.runtime/` state is not a validation run.

### 23.4 Per-phase launch validation

**Phase 0**
- Anonymous `POST /api/settings` returns **401** (not 200 with a Super Admin identity).
- A `NOC Operator` token on `POST /api/recovery/approve` returns **403**; `SRE Lead` returns 200.
- 60 login attempts with a **rotating `X-Forwarded-For`** header hit 429 before attempt 51.
- Browser request with `Origin: https://evil.corp` is rejected.
- Admin → Audit and Admin → SSO views render **"No records"** on a fresh instance, not seeded entries.
- Start with a deliberately malformed `config/apps/*.yaml` — the server **refuses to boot** with a named error.
- With Python absent, Jenkins `responseTime` shows DATA_UNAVAILABLE, **not** a number in the 85–105 range.
- Process count: no accumulation of orphaned `python` processes after 10 minutes of runtime.

**Phase 1** — POST a synthetic OTLP payload with `host.name: newhost-01.corp` from an unknown host; `GET /api/v2/entities?kind=host` includes it within one collection cycle, linked to its app.

**Phase 1b** — point one app at the fixture's `/302-idp` route: the tile shows **AUTH_FAILED**, visibly distinct from DATA_UNAVAILABLE and from healthy. Point another at `/401`: same. Stop the fixture entirely: that tile shows DATA_UNAVAILABLE. Three distinct states, three distinct renderings.

**Phase 1c — the multi-user test, run it in two real browser profiles**
1. Browser A logs in, selects **PROD**. Browser B logs in, selects **STG**.
2. Leave both open for 10 minutes under active collection.
3. **Neither switches.** B stays on STG; its alerts and recovery panels stay STG.
4. Browser C selects **DEMO**. A and B are unaffected; no simulation in A or B is cleared.
5. Throughout, the OTLP fixture pushes with `environment: prod` resource attributes. Query the DB: **every row is tagged `prod`**, regardless of what any browser had selected.

Step 5 is the one that matters most — it proves UI state no longer corrupts ingest.

**Phase 2** — run the OTLP fixture at 1,000 rows/sec for 10 minutes. Watch `/api/v2/ingest/health`: queue depth stable, zero drops, p95 ack under 150ms, RSS under 2GB. Confirm `.runtime/sentinel_db.json` does **not** grow (metrics no longer land there).

**Phase 2b — the config-only proof, run in two passes**
- *Pass 1, placeholder config:* every tile reads DATA_UNAVAILABLE; preflight reports every target unreachable with a reason. **No tile shows a number.**
- *Pass 2, fixture config:* preflight is green; every tile shows the **fixture's known values**. Change a fixture value, wait one cycle, confirm the tile follows it.
- Static gate: `grep -rn "Math.random" metrics_collection/real/ logs_collection/real/` returns nothing.

**Phase 3** — tail a log file, restart Sentinel mid-write, confirm no duplicated or dropped lines. Search returns the written lines. Confirm redaction: write a line containing a fake token and PAN, then verify neither appears in the DB or in S3.

**Phase 4** — drive the fixture to degrade 14 apps sharing one storage entity. Within 60 seconds the Blast Radius View names that entity, confidence > 0.75, blast radius 14, with an evidence chain citing real event ids.

### 23.5 UI regression gate (constraint C1)

Before starting, capture reference screenshots of every existing view at 1920×1080 and at 400px width: Health, Metrics, Command Center, Misc, Matrix, PowerBI, AI Logs, plus the Admin and YAML views.

After every phase, re-capture and diff. **Any visual difference in an existing view is a defect** unless it is a data value changing from a fabricated number to DATA_UNAVAILABLE, which is expected and intended. New Views are exempt.

### 23.6 Rules for the agent during validation

- **Never point validation config at a real production endpoint.** The fixture server is the only upstream during development.
- **Never disable a failing check to make a run pass.** A red check is the deliverable.
- If a phase's launch validation cannot pass, stop and report rather than proceeding to the next phase — the phases are dependency-ordered and a broken foundation compounds.
- Record each validation run's output in the phase PR description.
