# Codebase Map

Every folder and file in the repository, with what it is for. Generated against the tree at commit `423d7b6`; 338 tracked files excluding the compiled `frontend/dist/`.

**Read `CLAUDE.md` first** for the architecture narrative. This file is the index, not the explanation.

---

## Root

| File | Purpose |
|---|---|
| `package.json` | npm workspace root. Declares the eight workspace packages and every script (`launch`, `dev`, `build`, `test`, `lint`, `migrate`, `preflight`, `bootstrap`). |
| `package-lock.json` | Dependency lockfile. Commit changes to it deliberately. |
| `.nvmrc` | Pins Node to 24.x. |
| `.env.example` | Template for environment variables. Copy to `.env`, or let `scripts/bootstrap.js` create one. |
| `.gitignore` | Excludes `.env`, `.runtime/`, `node_modules/`, `frontend/dist/`, the validation Chrome profile, and `database/sentinel_users.json`. |
| `.eslintrc.json`, `.prettierrc` | Root lint/format config. Present but not invoked by any script — the frontend uses `oxlint`. |
| `CLAUDE.md` | Orientation for AI coding agents. Architecture, commands, conventions, known traps. |
| `CODEOWNERS` | Review ownership. |
| `LICENSE`, `README.md` | Licence and project overview. **The README still describes an old `apps/`/`packages/` layout — trust the code.** |
| `web.config` | IIS hosting. Routes all traffic to `node.exe` via HttpPlatformHandler; enables WebSockets. |
| `install_service.ps1` | Registers the app as a Windows scheduled-task daemon. |
| `start.bat` | One-click Windows launcher: install, build, start. |

---

## `backend/` — HTTP API, WebSocket, auth

| File | Purpose |
|---|---|
| `server.js` | **The single entry point.** ~1,500 lines holding every route, the middleware chain, health calculation, the WebSocket server, and startup. Middleware order matters: compression → helmet → CORS → body parser → rate limiters → `requireAuth` → routes → static → SPA fallback. |
| `audit_logger.js` | Writes every mutating operation to a durable file (the local WAL), mirrors it into the append-only `audit_event` table, and emits to stdout for SIEM. Reads are bounded-tail to avoid OOM. |
| `cors_validator.js` | Exact-match origin allowlist. Suffix matching was removed — it let any `*.corp` host through. |

### `backend/auth/`
| File | Purpose |
|---|---|
| `ldap_client.js` | eLDAP / Active Directory authentication. Real `ldapjs` bind in production, group→role mapping; a controlled test-user table in non-production only. |
| `session.js` | JWT issue and verify via `jose`. Exits the process at require time if `SENTINEL_JWT_SECRET` is missing. |

### `backend/config/`
| File | Purpose |
|---|---|
| `config.js` | Flattens the YAML tree into the runtime config object. Owns `normalizeEnvironment()` — the single place `production`/`prd`/`stg` are mapped to the canonical `prod`/`staging`/`demo`. `ACTIVE_URLS` is a **getter**; never cache it. |
| `yaml_config.js` | Loads, caches and validates every YAML file. Tracks the real source file per id (including aliases) so lookups survive id/filename divergence. |
| `environment_resolver.js` | Picks the prod or staging URL set for a given environment. |
| `expiryEngine.js` | Certificate, licence and token expiry evaluation. |
| `simulations.js` | The chaos-simulation registry used by staging and demo. |
| `package.json` | Workspace manifest for `@sentinel/config`. |

### `backend/config/cyberark/`
| File | Purpose |
|---|---|
| `credential_provider.js` | Resolves secrets: cache → CyberArk CCP → namespaced env var. Supports per-request TTL for short-lived tokens. |
| `cyberark_client.js` | The CCP HTTP client itself. |

### `backend/services/`
| File | Purpose |
|---|---|
| `health/healthCalculator.js` | Deterministic health score and per-component status. The only place severity weights are applied. |
| `telemetry/uptimeResolver.js` | Uptime calculation and formatting. |
| `ai_analysis/*.js` (5 files) | One-line re-export shims over the top-level `ai_analysis/` package. **Edit the top-level implementation, not these.** |
| `remediation/*.js` (2 files) | Same pattern for `remediation/`. |

### `backend/extensions/`
| File | Purpose |
|---|---|
| `rca_analytics.js`, `ticket_analytics.js` | Standalone analytics modules, retained but not wired into routes. |

---

## `database/` — persistence

| File | Purpose |
|---|---|
| `db.js` | The metric/alert/recovery store. A bounded write-ahead queue drains in batches to Postgres; a small cache persists to `.runtime/sentinel_db.json` for settings and control state only. Enforces environment segregation and the demo synthesis path. |
| `postgres.js` | Connection pool and metric read/write. `query()` returns `null` when no pool is configured and **throws** when a configured host is unreachable — callers must handle both. |
| `postgres_users.js` | Identity, backed by the `app_user` table. The local JSON file is a development fallback only and is refused in production. |
| `log_store.js` | Log ingest and search against the `log_event` hypertable, with a ring-buffer fallback. |
| `event_store.js` | Normalised event store feeding the correlation engine. |
| `expiry_store.js` | Certificate/licence expiry records. |
| `snowflake.js` | Snowflake adapter for cold log analytics. |
| `migrate.js` | Forward/rollback migration runner (`npm run migrate`). |
| `metrics_history.jsonl` | Legacy rolling archive. Superseded by the database; retained for compatibility. |
| `package.json` | Workspace manifest for `@sentinel/database`. |

### `database/migrations/` — 6 migrations, each with a `.down.sql`
| Migration | Creates |
|---|---|
| `001_create_entity_schema` | `entity`, `entity_edge` — the inventory graph |
| `002_create_metric_storage` | `metric` hypertable plus 1m/1h continuous aggregates |
| `003_create_log_schema` | `log_event` hypertable, full-text and BRIN indexes |
| `004_create_event_schema` | `event` — the correlation event bus |
| `005_create_expiry_schema` | `expiry_item` |
| `006_create_user_audit_schema` | `app_user`, `audit_event` (append-only), `sso_login_event` |

---

## `inventory/` — the entity model (`@sentinel/inventory`)

| File | Purpose |
|---|---|
| `index.js` | Package entry; upsert and query API. |
| `store.js` | Persistence for entities and edges. |
| `entity_resolver.js` | Deterministic id scheme (`host:<fqdn>`, `agent:<app>:<name>`, …) so an entity keeps its identity across restarts. |
| `sources/yaml_source.js` | Declared topology from the config tree. |
| `sources/otlp_source.js` | **Auto-registration from OTLP pushes** — how ~2,000 hosts enrol without a maintained list. |
| `sources/jenkins_source.js` | Enumerates Operations Centers, controllers and the build-agent fleet. |
| `sources/teamcity_source.js` | Enumerates TeamCity agents. |
| `sources/k8s_source.js` | Cluster nodes and pods. |
| `sources/avi_source.js` | Virtual services and pool members. |

---

## `metrics_collection/` — telemetry in

| File | Purpose |
|---|---|
| `collector_coordinator.js` | The polling loop. Three tiers (10s apps+logs, 30s and 120s infra), sharded by `SENTINEL_ROLE`. |
| `telemetry_provider_selector.js` | Maps the active telemetry profile (1 OTel, 2 Dynatrace, 3 node_exporter) to the collectors allowed to run. |
| `concurrency_limiter.js` | Worker-pool bound for fan-out. |
| `shared/collector_contract.js` | **The contract every collector returns**: status, metrics, source, observedAt, error. |
| `shared/circuit_breaker.js` | Per-target breaker — essential at 2,000 targets. |
| `shared/fetch_with_fallback.js` | Authenticating HTTP client with timeout; applies the per-app `auth:` scheme. |
| `sources/telemetry_source.js` | Pluggable source interface, so Dynatrace can be removed by config. |

### `real/` vs `simulation/` — parallel trees, same filenames
`USE_SIMULATED_COLLECTORS` picks one at startup. **Edit both or startup breaks in one mode.**

| Path | Contents |
|---|---|
| `real/applications/` (15) | One collector per tool: argocd, argoworkflows, artifactory, bitbucket, bitbucket_external, fortify, github, jenkins, mcp, nexusiq, otkr, performance_center, sonarqube, teamcity, plus `app_collector.js` which auto-discovers from YAML. |
| `real/infrastructure/` (12) | avi, database, docker, k8s, linux, nas, network, node_exporter, s3, sso, windows, plus `infra_collector.js`. |
| `real/opentelemetry/` | `otlp_metric_normalizer.js` — maps OTel semantic names to Sentinel metrics, scales units. |
| `real/dynatrace/` | `dynatrace_collector.js`, `token_provider.js` (30-second token minting), `metric_resolver.js` (name-drift aliasing). |
| `real/probers/` | `url_probe_collector.js` — TLS/status/latency for systems exposing only a URL. |
| `real/python_checks/` | `runner.js`, `selenium_ui_check.py`, `requirements.txt` — synthetic SSO login probes. |
| `simulation/…` (28) | Signature-identical twins. **This is the only place jitter and baselines legitimately live.** |

---

## `logs_collection/` — logs in

| File | Purpose |
|---|---|
| `real/fluentd/fluentd_log_collector.js` | Tails NAS-mounted logs with persistent byte-offset checkpoints and rotation detection. |
| `simulation/fluentd/fluentd_log_collector.js` | Simulation twin. |
| `parser/log_parser.js` | Per-app pattern packs; extracts level/timestamp/fields and computes the fingerprint used for novelty detection. |
| `archival/s3_archiver.js` | Daily gzipped NDJSON archival to S3 before DB retention expires. |

---

## `ai_analysis/` — detection (`@sentinel/analysis`)

| File | Purpose |
|---|---|
| `index.js` | Package entry; selects the real or simulation analyzer. |
| `real_analyzer.js` | Log anomaly detection — pattern, novelty and rate-spike. Raises alerts and triggers recovery. |
| `simulation_analyzer.js` | Simulation twin. |
| `predictive.js` | Linear regression over metric history to forecast threshold breaches. |
| `rca_analytics_engine.js` | Per-app root-cause profiles. **Demo data source only** — prod/staging read real hypotheses. |
| `team_rota_service.js` | On-call rota, including Excel/CSV import. |

## `correlation/` — the RCA engine (`@sentinel/correlation`)
`index.js` walks the entity graph from a symptom, scores candidates by fan-out, temporal precedence, graph distance and change proximity, and emits ranked hypotheses with an evidence chain.

## `remediation/` — self-healing

| File | Purpose |
|---|---|
| `recovery.js` | Runbook orchestration and the four-eyes approval queue. Two distinct approvers required. |
| `custom_checks.js` | Operator-defined synthetic checks. States initialise to `UNKNOWN`, never `Healthy`. |
| `real/jenkins/jenkins_trigger.js`, `simulation/…` | Dispatches the Jenkins remediation job. |

## `shared/` — `@sentinel/shared-constants`
`index.js` + `index.d.ts`. `SEVERITY`, `SEVERITY_COLORS`, `SEVERITY_WEIGHTS`, `normalizeSeverity()`. **CommonJS** — which is why `frontend/vite.config.js` must pre-bundle it.

## `logger/`
`logger.js` — rotating audit-grade file stream (500MB / daily / 30 files / gzip) to the NAS mount, falling back to `.runtime/nas_logs`.

---

## `frontend/` — React 19 + Vite SPA

| File | Purpose |
|---|---|
| `vite.config.js` | Dev server, `/api` `/v1` `/ws` proxies to `127.0.0.1:3001`, and the `optimizeDeps` entry that makes the CommonJS shared package importable in dev. |
| `index.html`, `src/main.jsx` | Entry point. |
| `src/App.jsx` | The stateful shell: tab routing, REST bootstrap, WebSocket subscription, environment switcher. |
| `src/App.css`, `src/index.css` | All styling. |
| `src/maintenanceConfig.js` | Banner toggles. |
| `src/data/correlationData.js` | Demo fixture catalogs **and** the live API client helpers. Components use the fixtures in demo and the API in prod/staging. |

### Components by domain
| Folder | Files |
|---|---|
| `health/` | `HealthOverview.jsx` (the landing dashboard), `UnifiedHealthMatrix.jsx` |
| `analytics/` | `MetricsDetail.jsx`, `PowerBiDashboard.jsx`, `RcaDashboard.jsx`, `AiLogPerformance.jsx`, `CustomChart.jsx` |
| `correlation/` | `UnifiedCorrelationTimeline.jsx`, `BlastRadiusView.jsx`, `EntityExplorerView.jsx`, `EntityDrillDownPanel.jsx`, `GlobalEntitySearch.jsx`, `DriftRcaCorrelationFeed.jsx` |
| `fleet/` | `FleetExplorerView.jsx` |
| `logs/` | `LogExplorerView.jsx` |
| `ops/` | `PipelineOpsView.jsx` |
| `sre/` | `CommandCenter.jsx`, `SreEnterpriseControl.jsx`, `MiscOperations.jsx`, `SelfRunbook.jsx` |
| `admin/` | `AdminManagement.jsx`, `YamlConfigManager.jsx` (read-only), `PreflightCheckView.jsx` |
| `shared/` | `StatusBadge.jsx`, `Sparkline.jsx`, `MaintenanceNotice.jsx` |

---

## `config/` — the single source of truth

| Path | Purpose |
|---|---|
| `global.yaml` | Active environment, prod/staging URL sets, SSO config, collector and per-app toggles. **The primary file to edit for a deployment.** |
| `telemetry.yaml` | Telemetry profile selector. |
| `cyberark.yaml` | Safe and object registry for credential resolution. |
| `correlation.yaml` | Correlation scoring weights — tunable without a deploy. |
| `dynatrace_metric_aliases.yaml` | Candidate metric selectors, for surviving Dynatrace renames. |
| `custom_checks.yaml` | Operator-defined check registry. |
| `apps/*.yaml` (17) | One manifest per monitored tool: endpoints, topology, layers, auth, credentials, lifecycle, remediation job. |
| `infra/*.yaml` (7) | avi, docker, k8s, nfs, sso-eldap, unix, windows. |
| `.env.example`, `README.md` | Config onboarding. |

---

## `tests/` — 24 suites, plain `node` + `assert`

Security and correctness: `auth_lockdown`, `ldap_client`, `recovery_four_eyes`, `alert_env_tagging`, `cyberark_provider`.
Data rules: `prod_data_availability`, `data_availability_segregation`, `env_strict_value_not_available`, `schema_validation`, `datastore_migration`.
Pipeline: `otlp_normalizer`, `telemetry_selector`, `collector_auth`, `collector_truthfulness`, `load_ingest`, `log_pipeline`.
Model: `inventory_discovery`, `entity_hierarchy`, `environment_isolation`, `correlation_replay`, `source_hardening`, `shipper_rollout`.
Plus `e2e_qa_suite`, `misc_operations`. Not in `npm test`: `load_test_200.js`, `test_live_otlp.js`.

## `scripts/`

| File | Purpose |
|---|---|
| `bootstrap.js` | Makes a fresh clone runnable — generates a dev `.env`, creates runtime dirs, reports degraded mode. Refuses to generate a secret in production. |
| `setup_symlinks.js` | Creates the `@sentinel/*` symlinks. **Register any new workspace package here.** |
| `preflight_check.js` | Walks every configured endpoint and reports reachable / auth-OK / unreachable. |
| `lint_no_random.js` | Fails if `Math.random()` appears in any real collector. |
| `lint_severity_constants.js` | Fails on inline severity literals. |
| `generate_shipper_configs.js` | Renders per-host Fluent Bit configs from the inventory. |
| `verify_all_endpoints.js` | Live route smoke test (needs a running server). |
| `cyberark_fetch.py` | CCP helper invoked as a subprocess. |

## `tools/validation/`
`docker-compose.validation.yml` and `init-db.sql` stand up a disposable Postgres. `run_phase0_checks.js` … `run_phase5_checks.js` are the per-phase launch gates. `capture_screenshots.js` captures the UI regression baseline. **`run_phase1b_checks.js` starts its own server — run it with port 3001 free.**

## `deployments/`
`ansible/` (Linux OTel, node_exporter, Fluent Bit), `powershell/` (Windows equivalents), `k8s/` (DaemonSets), `opentelemetry_configs/`, `fluentbit_configs/`, `windows/` (IIS assets), `Jenkinsfile` (fleet rollout pipeline).

## `docs/`
`ARCHITECTURE.md` and `PRODUCTION_GUIDE.md` (**both contain claims that no longer match the code — see §20 of the remediation plan**), `SECURITY.md`, `REMEDIATION_PLAN.md` (the specification), `PROGRESS.md` (state), `PRODUCTION_IMPLEMENTATION_PLAN.md` (rollout), and this file.
