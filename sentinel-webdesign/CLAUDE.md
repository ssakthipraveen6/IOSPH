# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Project Sentinel is an observability and autonomous-recovery portal: Node.js/Express backend + React 19/Vite SPA. It ingests telemetry (OpenTelemetry OTLP push, per-app collectors, Selenium synthetic probers), detects log anomalies, correlates them against an entity graph to find shared-infrastructure root causes, and triggers Jenkins remediation runbooks under four-eyes governance. Target hosting is two Windows Servers behind AVI + IIS. Node is pinned in `.nvmrc` (24.x).

**Trust the code and the documents below.** The old design and plan documents were removed; the README holds the architecture and docs/PRODUCTION_READINESS_PLAN.md holds the production work.

## Orientation

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | Architecture diagram and a short summary of each function |
| [`docs/PRODUCTION_READINESS_PLAN.md`](docs/PRODUCTION_READINESS_PLAN.md) | Production steps with file, line and sample values |
| [`docs/jira_production_readiness.csv`](docs/jira_production_readiness.csv) | The same tasks as a Jira import |
| [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md) | Every folder and file, with its purpose |
| [`config/README.md`](config/README.md) | How to add, change or remove an application |

## Current state

Phases 0 through 5 of the remediation plan, Milestone 1 (Foundation), Milestone 2 (Golden Journeys & Synthetics), and Milestone 3 (Layer Fingerprinting & AVI) have landed. Notably, and contrary to what the older docs say:

- Real collectors **no longer fabricate data** — zero `Math.random()`, enforced by `npm run lint:random` and `npm run lint:samples`.
- Anonymous mutating requests are **rejected with 401**, not granted Super Admin. Read access is protected by `requireReadAccess`.
- Environment selection is **per-session**, carried in the JWT claim. One user switching to PROD does not affect anyone else, and OTLP ingest is tagged from agent attributes rather than UI state.
- Ingest API keys support scoped authentication (`ingest`, `read`, `gateway`, `admin`, `agent`) with SHA-256 hash lookup and allowed environments isolation for shared gateways.
- Multi-node high availability uses PostgreSQL advisory lock leader election (`leader_lock.js`) and role profile 4 sharding.
- ClickHouse columnar telemetry datastore is fully integrated (`database/clickhouse.js`) with migrations, rollups (`metrics_1h` for queries >= 1h step), spans, events, change_points, agent_inventory, and parameterised log searches.
- Source arbiter implements 3-sample hysteresis and immediate failover on collector `AUTH_FAILED`.
- Synthetics runner (`@sentinel/synthetics`) executes multi-step canary journeys (`http`, `browser`, `git`, `upload_download`) with W3C trace generation and step metric emission.
- Multi-layer topology discovery parses manifest `layers:` into an entity graph (VIP -> Product -> Host -> Share -> Database) exposed via `/api/v2/topology/:productId`.
- VIP probes measure DNS, TCP, TLS, TTFB, total latency, and SSL certificate expiry with telemetry exposed in the rewired AVI view.
- Correlation engine implements rules (a)-(e) diagnosing network/AVI, storage, product, and change root causes.
- `postgres.js` writes and filters the `environment` column.
- `bitbucket_pr_service.js` was **deleted**. Do not recreate it — it formed a credential-exfiltration chain (plan §4.1, T0.13).

## Commands

Run from the repo root (npm workspaces). The backend has no build step.

**Getting started**
- `npm install` — installs workspaces and creates the `@sentinel/*` symlinks via `postinstall`
- `npm run launch` — bootstrap, build, start. Works on a fresh clone with no manual setup
- `npm run serve` — bootstrap, verify the committed bundle, start. **Production path — no build step**
- `npm run dev` — backend + Vite HMR on :5173, proxying `/api` `/v1` `/ws` to :3001

**Verify**
- `npm test` — **36** suites, plain `node` + `assert`, sequential. Single: `node tests/otlp_normalizer.test.js`
- `npm run config:check` — validates every manifest, prints enabled/endpoint per app. Exits 1 on error
- `npm run verify:dist` — fails if `frontend/dist` is stale relative to `frontend/src` or has unreferenced assets
- `npm run preflight` — walks every configured endpoint: reachable / auth-OK / unreachable
- `npm run lint` — `lint:constants` + `lint:random` + `lint:samples` + frontend `oxlint`
- `npm run lint:samples` — validates that no sample/fake data generators leak outside `demo`
- `npm run audit:check`

**Database & Migrations**
- `npm run migrate` / `npm run migrate:down` — PostgreSQL migrations
- `npm run clickhouse:migrate` — apply ClickHouse migrations
- `npm run clickhouse:migrate:dry-run` — test and print pending ClickHouse DDL
- `npm run clickhouse:migrate:status` — view applied ClickHouse migration versions
- `npm run ingest-key` — manage ingest API keys via CLI (`create`, `list`, `revoke`)

**Environment** — `SENTINEL_JWT_SECRET` (≥32 chars) is required; `backend/auth/session.js` exits at require time without it. `scripts/bootstrap.js` generates one for development and **refuses to in production**. Read from `config/.env` or the repo root. Others: `NODE_ENV`, `PORT`, `ALLOWED_ORIGIN`, `SENTINEL_ROLE`, `USE_SIMULATED_COLLECTORS`, `CLICKHOUSE_URL`.

## Architecture

### Module wiring — read this first

Modules import siblings as `@sentinel/*`: `analysis`→`ai_analysis`, `api`→`backend`, `collector`→`metrics_collection`, `config`→`backend/config`, plus `database`, `logger`, `remediation`, `inventory`, `correlation`, `shared-constants`→`shared`. These resolve through symlinks created by `scripts/setup_symlinks.js`. If a require fails, run `npm run setup`. **Register any new workspace package there.**

`backend/services/ai_analysis/*.js` and `backend/services/remediation/*.js` are one-line re-export shims — edit the top-level implementation.

### Configuration is YAML-first

Everything user-editable lives under `config/`. Adding an application is **one file**: copy `config/apps/_TEMPLATE.yaml`, fill five required fields, run `npm run config:check`, restart.

- `global.yaml` — environment, `prod_urls`/`stg_urls`, SSO, master toggles
- `apps/*.yaml` — one per application, each carrying its own `enabled:` flag
- `infra/*.yaml` — shared infrastructure layers
- `ui.yaml` — banner text, served live via `GET /api/ui-config`; **no rebuild needed**
- `cyberark.yaml`, `telemetry.yaml`, `correlation.yaml`, `dynatrace_metric_aliases.yaml`, `custom_checks.yaml`
- `.env` — gitignored, created by bootstrap

Files prefixed `_` are ignored by the loader.

**Enabled precedence**, most specific first: `applications_enabled.<id>` in `global.yaml` (operator override) → the manifest's own `enabled:` → `true`.

`config.js` owns `normalizeEnvironment()` — `production`/`prd`→`prod`, `stg`/`stage`→`staging`, unknown→warn and fall back. The rest of the system speaks only `prod|staging|demo`. This normalisation is what closed the production auth bypass; don't reintroduce raw string comparisons.

`ACTIVE_URLS` is a **getter** resolved at call time. Never cache it at module load.

### Environments

- **Runtime environment** `prod|staging|demo` — **per session**, from the JWT claim or `?environment=`, resolved by `resolveEnvironment()` in `server.js`. There is no server-wide global. The coordinator always collects `staging` and `prod` in the background regardless of UI state, setting `global.collectorEnvironment` per pass so each resolves its own URL set.
- **Collector mode** `real|simulation` — chosen once at startup from `USE_SIMULATED_COLLECTORS`. `metrics_collection/`, `logs_collection/` and `remediation/` each have parallel trees with matching filenames. **Edit both or startup breaks in one mode.**
- **Never fabricate in prod or staging.** Missing data surfaces as `null` / `DATA_UNAVAILABLE`. Only `demo` synthesizes. Enforced by `lint:random` and four test suites.
- **`AUTH_FAILED` is distinct from `DATA_UNAVAILABLE`** — a rotated token must not look like an outage.

### Data flow

1. **Poll** — `collector_coordinator.js` runs three tiers (10s apps+logs, 30s/120s infra), sharded by `SENTINEL_ROLE`, with per-target circuit breakers. `app_collector.js` auto-discovers apps from YAML and loads `<appId>_collector.js` **by dynamically constructed path** — static analysis will report these as unreferenced; they are not.
2. **Push** — OTLP agents `POST /v1/metrics` → `otlp_metric_normalizer.js` → `db.addMetricBatch`.
3. **Store** — `db.js` holds a bounded write-ahead queue draining in batches to TimescaleDB, with a cardinality guard. `.runtime/sentinel_db.json` keeps settings and control state only, **not metrics**.
4. **Broadcast** — WebSocket `/ws` sends `init`, `state`, `metrics_tick` (5s), `log`. Clients subscribe with a scope; the server holds no global environment.
5. **Detect and heal** — `real_analyzer.js` → `db.addAlert` → `recovery.js`. Runs immediately if `autonomousMode` or manual, else parks as `Awaiting-Approval` needing **two distinct approvers**.
6. **Correlate** — `@sentinel/correlation` walks the entity graph, scoring by fan-out, temporal precedence, graph distance and change proximity.

### Backend

`backend/server.js` is the single Express + `ws` entry point. Middleware order: compression → helmet → CORS (**exact-match allowlist** in `cors_validator.js`) → body parser → rate limiters → `requireAuth` → routes → static → SPA fallback.

`trust proxy` at **line 51** takes an explicit proxy set — **add your AVI SNAT addresses** or all users share one rate-limit bucket.

Auth is eLDAP via `ldapjs` in `ldap_client.js` (reads `ldap_url`, not `url`), with `jose` JWTs in `session.js`. The session token is an **httpOnly cookie**, not `localStorage`. Audit entries go to a durable file, the append-only `audit_event` table, and stdout for SIEM.

### Frontend

`App.jsx` is the stateful shell: tab routing, REST bootstrap, WebSocket subscription, environment switcher. `main.jsx` hydrates `config/ui.yaml` before first render. Components sit under `components/{admin,analytics,correlation,fleet,health,logs,ops,shared,sre}`.

`frontend/dist` is **committed** so production hosts need no build toolchain. `npm run build` records a source fingerprint; `verify:dist` fails if they diverge. **Rebuild and commit `dist` whenever you change frontend code.**

## Conventions and gotchas

- Severity values come only from `@sentinel/shared-constants`. `lint:constants` enforces it.
- `shared/index.js` is **CommonJS**, which is why `vite.config.js` must pre-bundle it via `optimizeDeps` — otherwise the dev server blanks with "does not provide an export named 'SEVERITY'".
- Component ids are shared strings across YAML `id`, collector filenames, health components and recovery workflows. Renaming one means touching all.
- Cross-module calls use globals to avoid circular deps: `global.broadcastStateChange`, `global.broadcastLog`, `global.collectorEnvironment`, `global.runSelfHealingOrchestrator`, `global.runPredictiveAnalysis`.
- **Toggles gate collectors, not infrastructure clients.** The database pool, CyberArk and Snowflake are built from their URL alone. To make a deployment inert, **blank the URL** rather than disabling the feature — measured: toggles off with `db_jdbc` set still produced 15 outbound attempts in 25 seconds; blanked, zero.
- `postgres.query()` returns `null` when no pool is configured but **throws** when a configured host is unreachable. Handle both — conflating them previously took the whole process down.
- Validation harness checks need the **same** `SENTINEL_JWT_SECRET` as the running server, or a rejected token looks like a broken role check.
- **Milestone M2 (Golden Journeys & Toolchain Synthetics):** `@sentinel/synthetics` runs canaries end-to-end (`http`, `browser`, `git`, `upload_download`). Only the active leader node executes journeys (`leaderLock.isLeader()`), bounded at concurrency 4 with jitter via `crypto.randomInt`. Step failures cascade subsequent steps to `SKIPPED`. Product versions are tracked via `version_tracker.js` and emit `version_change` events. Toolchain products and journey runs are exposed via `/api/products` and `/api/journeys` and visualized in `ProductPage.jsx`.
