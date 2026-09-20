# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Project Sentinel is an observability and autonomous-recovery portal: Node.js/Express backend + React 19/Vite SPA. It ingests telemetry (OpenTelemetry OTLP push, per-app scrapers, Selenium synthetic probers), runs regex-based log anomaly detection, and triggers Jenkins remediation runbooks under four-eyes (2-approver) governance. Target hosting is Windows Server behind AVI + IIS (`web.config`, `install_service.ps1`, `start.bat`). Node version is pinned in `.nvmrc` (24.x). Long-form references: `docs/ARCHITECTURE.md`, `docs/PRODUCTION_GUIDE.md`, `docs/SECURITY.md`, `config/README.md`, `deployments/README.md`.

**The README and `docs/` still describe an older layout (`apps/api`, `apps/web`, `apps/collector`, `packages/*`). The real layout is flat: `backend/`, `frontend/`, `metrics_collection/`, etc. Trust the code, not those paths.**

## Remediation in progress

A production-readiness review found this codebase to be roughly a 15–20% prototype against its stated requirement. **Before changing anything, read [`docs/REMEDIATION_PLAN.md`](docs/REMEDIATION_PLAN.md)** (the specification, 10 phases, 73 tasks) and **[`docs/PROGRESS.md`](docs/PROGRESS.md)** (current state).

Key things that file establishes and this one does not repeat:

- Large parts of the “real” collectors **fabricate data** — 46 `Math.random()` calls across 25 collectors, and the whole infrastructure tier returns hardcoded constants. Correct URLs alone will not produce real values.
- `requireAuth` grants **anonymous mutating requests Super Admin**, so RBAC is currently decorative.
- Environment selection is a **single server-wide global**, so one user switching to PROD flips every other user and mis-tags all inbound OTLP.
- `postgres.js` never writes the `environment` column and never filters on it, so historical metrics have **no environment segregation** despite three test suites named for it.

Findings are derived from reading the code, not running it. See §22 of the plan for review coverage.

---

## Commands

Run from the repo root (npm workspaces). There is no build step for the backend.

- Install: `npm run install-all` (root + frontend + symlinks). Plain `npm install` also runs `scripts/setup_symlinks.js` via `postinstall`.
- Dev (backend + Vite HMR): `npm run dev`; individually `npm run dev-backend` / `npm run dev-frontend`. Vite runs on :5173 and proxies `/api`, `/v1`, `/ws` to :3001.
- Production: `npm run build` (writes `frontend/dist`, which Express serves statically), then `npm start` (port `PORT`, default 3001). On Windows `start.bat` does install + build + start.
- Tests: `npm test` runs 11 `tests/*.test.js` files sequentially with plain `node` and `assert`; there is no runner or watch mode. **Single test:** `node tests/otlp_normalizer.test.js`. Not in `npm test`: `tests/load_test_200.js`, `tests/test_live_otlp.js`, and `scripts/verify_all_endpoints.js` (the last one needs a running server on :3001).
- Lint: `npm run lint` = `lint:constants` (`scripts/lint_severity_constants.js`) + `oxlint` in `frontend/`. Root `.eslintrc.json` and `.prettierrc` exist, but no script invokes them.
- `npm run audit:check` = `npm audit --audit-level=high`.
- Required env: `SENTINEL_JWT_SECRET` (>=32 chars). `backend/auth/session.js` calls `process.exit(1)` at require time without it, which also kills any test that imports the auth module. It auto-reads a repo-root `.env` if the var is unset. Other env: `USE_SIMULATED_COLLECTORS`, `ENVIRONMENT`, `TELEMETRY_PROVIDER` / `TELEMETRY_PROFILE`, `ALLOWED_ORIGIN(S)`, `PGUSER` / `PGPASSWORD`, `NODE_ENV`; see `.env.example`.

## Architecture

### Module wiring (read this first)

Code imports sibling packages as `@sentinel/*`: `analysis`→`ai_analysis`, `api`→`backend`, `collector`→`metrics_collection`, `config`→`backend/config`, `database`, `logger`, `remediation`, `shared-constants`→`shared`. These resolve through symlinks that `scripts/setup_symlinks.js` creates in `node_modules/@sentinel`. If a `require('@sentinel/...')` fails, run `npm run setup`. `backend/server.js` mixes styles: it requires most modules by relative path (`../database/db`) while the modules themselves use `@sentinel/*`. Both resolve to the same files. `backend/services/ai_analysis/*.js` are one-line re-export shims; edit the top-level `ai_analysis/` implementation.

### Configuration is YAML-first

`config/global.yaml` (environment, `prod_urls` / `stg_urls`, `collectors`, `components_enabled`, `applications_enabled`, SSO/LDAP), `config/telemetry.yaml` (profiles), `config/cyberark.yaml`, plus one YAML per monitored tool in `config/apps/` and `config/infra/`. Loaded and cached by `backend/config/yaml_config.js`. Cache resets happen only through its save functions, so edits on disk need a restart or an API save. `backend/config/config.js` flattens YAML into `ACTIVE_URLS`, which is a **getter** that switches between prod and staging URLs based on `global.runtimeEnvironment`. Never cache its result at module load. Each app YAML needs an `id`, and `yaml_config.validateConfig()` requires an endpoint. Secrets come from CyberArk via `backend/config/cyberark/credential_provider.js` (cache, then CyberArk subprocess, then `${APPID}_${PURPOSE}` env var), not from `.env`.

### Environments and "real vs simulated" (two independent axes)

- **Runtime environment** `prod` | `staging` | `demo`: switched live with `POST /api/environment`, held in `runtimeEnvironment` in `server.js` and mirrored on `global.runtimeEnvironment`. Every metric, alert and recovery row in `database/db.js` carries an `env` tag and is filtered by it. `demo` never reads stored data: `db.js` synthesizes metrics, alerts and recovery logs, and the coordinator collects `demo` only while `setDemoActive(true)`. The coordinator always collects `staging` and `prod` in the background.
- **Collector mode** `real` | `simulation`: chosen once at startup from `USE_SIMULATED_COLLECTORS` (env overrides YAML). `metrics_collection/`, `logs_collection/`, and `remediation/` each have parallel `real/` and `simulation/` trees with matching filenames, loaded with a dynamic `require(`./${mode}/...`)`. Keep both trees' exports in sync when changing either.
- Rule enforced by tests (`data_availability_segregation`, `env_strict_value_not_available`, `prod_data_availability`): for `prod` and `staging`, missing or unreachable data must surface as `null` / `'Data Not Available'` / `SEVERITY.DATA_UNAVAILABLE`, never as fabricated values. Only `demo` may synthesize.

### Data flow

1. **Poll path:** `metrics_collection/collector_coordinator.js` runs three tiers on `setInterval` (10s apps + logs, 30s and 120s infra). `telemetry_provider_selector.js` maps the active telemetry profile (1 = OTel push + probers, the default; 2 = Dynatrace; 3 = Prometheus node_exporter) to the collector keys allowed to run, combined with the `components_enabled` toggles. `real/applications/app_collector.js` auto-discovers apps from YAML and requires `<appId>_collector.js` (or `<appId>.js`) from its own directory; that module exports `collect(simulations, base)`. A missing module or a failed fetch yields DATA_UNAVAILABLE. HTTP goes through `metrics_collection/shared/fetch_with_fallback.js` (3.5s timeout, never throws).
2. **Push path:** OTLP agents `POST /v1/metrics` (also `/api/metrics/otlp`) → `real/opentelemetry/otlp_metric_normalizer.js` (maps OTel names to Sentinel keys, scales 0-1 utilization to percent, bytes to MB, lowercases `application.id` / `host.name` into `component`) → `db.addMetricBatch`.
3. **Storage:** `database/db.js` is an in-memory write-behind cache (metrics capped at 200 in memory **globally**, not per environment — a chatty staging env evicts prod rows), flushed to `.runtime/sentinel_db.json` (async `saveDB`, sync flush on SIGTERM). Every metric write is also sent to Postgres/TimescaleDB (`database/postgres.js`, wrapped in `executeWithRetry` with degradation flags surfaced through `getPersistenceStatus`) and a rolling archive (`sqlite_metrics.js`). `snowflake.js` and `postgres.js` `fetchHistorical*` serve the `/api/pbi/*` analytics endpoints. Users and audit logs live in `database/postgres_users.js` (backed by `sentinel_users.json`).
4. **Push to UI:** `server.js` exposes `global.broadcastStateChange` / `global.broadcastLog`, which the coordinator, recovery and analyzers call. WebSocket `/ws` sends `init`, `state`, `metrics_tick` (every 5s) and `log` frames; a 30s ping heartbeat keeps proxy connections alive. Health score/status is computed in `backend/services/health/healthCalculator.js` using weights from `shared/`.
5. **Detect and heal:** `ai_analysis/real_analyzer.js` regex-matches log lines → `db.addAlert` → recovery callback. `remediation/recovery.js` `triggerRecovery` runs immediately if `settings.autonomousMode` (or a manual trigger), else parks the run as `Awaiting-Approval`. `approveRecovery` needs 2 distinct usernames before `executeRecoveryWorkflow` calls `remediation/<mode>/jenkins/jenkins_trigger.js`. Only one recovery per component runs at a time (`activeRecoveries`). Workflows come from the `bespokeWorkflows` table or an app YAML's `jenkins_remediation_job`.

### Backend server

`backend/server.js` (~1050 lines) is the single Express + `ws` entry point holding all routes, middleware, health calculation, and startup (it calls `collector.start()` on listen). Middleware order matters: compression → helmet → CORS (`cors_validator.js` — **not** exact-origin: it suffix-matches `.corp` / `.internal`, so `https://evil.corp` passes; see plan T0.12) → `express.json` (5mb) → rate limiters (general 2000/min, OTLP 1000/min, login 50/15min) → `requireAuth` → routes → static `frontend/dist` → SPA fallback (unknown `/api` and `/v1` paths return JSON 404). RBAC uses `requireRole(...)` with roles `Super Admin`, `SRE Lead`, `NOC Operator`, `Security Auditor`, `Viewer`, `Operator`; `Super Admin` bypasses all checks. Auth is eLDAP behind `backend/auth/ldap_client.js`, with hand-rolled HS256 JWTs in `session.js`. Config edits *appear* to go GitOps-style via `POST /api/yaml/raw` → `bitbucket_pr_service.js`, but that module has **no `require` statements** (`yamlConfig`, `writeNasLog`, `repoSlug` are all undefined) so it throws `ReferenceError` on first call, and it never contacts Bitbucket — it fabricates a random PR id. **Do not “fix” the imports**: that arms a credential-exfiltration chain (plan §4.1, T0.13). Mutations are recorded through `audit_logger.js`.

### Frontend

`frontend/src/App.jsx` (~950 lines) is the single stateful shell. It holds tab state (`health`, `metrics`, `command`, `misc`, `matrix`, `pbi`, `ailogs`), fetches the initial state over REST, then follows WebSocket frames. Components are grouped by domain under `frontend/src/components/{admin,analytics,correlation,health,shared,sre}` (each with a README). The JWT is read from `localStorage['sentinel_auth_token']`. The SPA uses only relative URLs and bundles no secrets.

### Other top-level directories

`deployments/` (Ansible, PowerShell, k8s DaemonSets, OTel agent configs, Jenkinsfile for fleet rollout), `scripts/` (`cyberark_fetch.py`, symlink setup, lint, endpoint smoke test), `logger/` (rotating `writeNasLog`, writes to the NAS mount or falls back to `.runtime/nas_logs`), `metrics_collection/real/python_checks/` (Selenium prober driven from Node via `runner.js`; needs Python + `requirements.txt`).

## Conventions and gotchas

- Severity/status/color/weight values come only from `@sentinel/shared-constants` (`shared/`): `SEVERITY`, `SEVERITY_COLORS`, `SEVERITY_WEIGHTS`, `normalizeSeverity()`. `npm run lint:constants` fails on inline `severity === 'Critical'` comparisons or inline color maps in `frontend/src/components` and `backend/services`. (The rule does not scan `ai_analysis/` or `remediation/`, which import the enum instead.)
- Component ids are shared strings across YAML `id`, collector filenames, `db.js` demo profiles, health components and recovery workflows (e.g. `jenkins_k8s`, `avi_load_balancer`, `nas_performance`). Renaming one requires touching all of them.
- Global hooks are used instead of imports to avoid circular deps: `global.broadcastStateChange`, `global.broadcastLog`, `global.runtimeEnvironment`, `global.runSelfHealingOrchestrator`, `global.runPredictiveAnalysis`.
- `NODE_ENV=production` plus `ENVIRONMENT=prod` makes `ldap_client.authenticate` reject every login (real LDAP bind is not implemented); other modes use a staging test-user table, so login works with any non-denied password.
- **Signature mismatches worth knowing before touching the heal path** (verified in code, not yet fixed):
  - `recovery.triggerRecovery(component, reason, isManualTrigger, env)`, but the coordinator calls `triggerRecovery(comp, reason, env)`. The env string lands in `isManualTrigger`, is truthy, and skips the four-eyes approval queue.
  - `real_analyzer.js` calls `db.addAlert(component, severity, message, env)`, but the signature is `(component, severity, message, status, env)`, so the env string becomes `status` and the alert gets the wrong env tag.
  - `runSelfHealingOrchestrator(infraMetrics, env)` only accepts `currentMetrics`.
  - The OTLP route calls both `db.addMetricBatch` and per-row `db.addMetric`, double-writing every metric to Postgres.
- `requireAuth` in `server.js` does not reject anonymous mutating `/api/*` requests; it assigns them a `Super Admin` identity ("local console operator fallback"). RBAC is therefore only meaningful once that fallback is removed. `/api/servicenow/active-incidents` returns hardcoded sample incidents plus alerts mapped to incidents.
