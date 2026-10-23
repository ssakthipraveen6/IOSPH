# Sentinel codebase map

What every folder and file is for, in one line each. Read the README first for the architecture; use this file to find where something lives.

Code files also carry a header comment and a one-line comment above each function, so the same summary is visible when you open the file.

## Top-level folders

| Folder | Purpose |
|---|---|
| `agent/` | What runs on each monitored server: OpenTelemetry collector configs, osquery packs, the Sentinel probe, and the packaging (RPM/DEB/MSI, systemd units). |
| `ai_analysis/` | Analysis package (@sentinel/analysis): anomaly baselines, alert engine, predictive checks, RCA, change points, scorecards, LLM assistant, on-call rota. |
| `analytics/` | Forecasting (capacity runway) and SentinelQL, the query language (lexer, parser, compiler to ClickHouse SQL). |
| `backend/` | The Express server: entry point, sign-in, all API routes, background jobs, services, configuration loaders and demo fixtures. |
| `ci/` | CI pipeline (Jenkinsfile). |
| `config/` | All YAML configuration: global settings, one manifest per application, infrastructure layers, CyberArk registry, alert rules, SLOs, telemetry profile. |
| `correlation/` | Correlation engine (@sentinel/correlation): links symptoms to shared infrastructure, diagnoses the failing layer, groups alerts into problems. |
| `database/` | Data access (@sentinel/database): main store, PostgreSQL, ClickHouse, event/log/expiry stores, leader lock, migrations. |
| `deployments/` | How to install things: Ansible playbooks and roles, Kubernetes manifests and Helm chart, OpenTelemetry gateway, Fluent Bit, PowerShell installers. |
| `docs/` | Production readiness plan, Jira import and this map. |
| `frontend/` | React 19 + Vite single-page app; built into frontend/dist and served by the backend. |
| `inventory/` | Inventory (@sentinel/inventory): entities (apps, hosts, VIPs, pods) and their relations, from YAML, OTLP, Jenkins, TeamCity, Kubernetes and AVI. |
| `logger/` | Structured logging package (@sentinel/logger). |
| `logs_collection/` | Log pipeline: Fluentd/Fluent Bit tailing, log parsing and S3 archive. |
| `metrics_collection/` | Metric collectors per application and infrastructure layer, Dynatrace and OTLP sources, circuit breaker, coordinator. |
| `remediation/` | Self-healing (@sentinel/remediation): runbooks via Jenkins, four-eyes approval, custom checks, ServiceNow link. |
| `scripts/` | Command-line tools: bootstrap, config check, preflight, readiness check, ingest keys, migrations, lints, demo simulator, CyberArk fetch. |
| `security/` | Security scanning package: SBOM / CVE matching. |
| `shared/` | Shared constants used by backend and front end (@sentinel/shared-constants): severities, colours. |
| `synthetics/` | Synthetic checks (@sentinel/synthetics): golden journeys and health checks with HTTP, browser, git, Jenkins and upload/download steps. |
| `tests/` | Automated tests (npm test runs every file listed in package.json test:all). |
| `tools/` | Local validation harness: docker-compose with TimescaleDB, fake upstream tools, sample OTLP agent, screenshot capture. |

## Folders and files

### `(repository root)`

Repository root: project settings, Windows start/service scripts and IIS configuration.

| File | What it does |
|---|---|
| `.env.example` | Example environment variables (copy to .env for local runs; never commit .env). |
| `.gitignore` | Files git ignores (secrets, runtime data, logs, build output). |
| `.npmrc.example` | Example npm registry settings for the internal registry. |
| `.nvmrc` | Node.js version (24). |
| `CLAUDE.md` | Guidance for Claude Code when working in this repository. |
| `CODEOWNERS` | Who reviews which folders. |
| `install_service.ps1` | Registers Sentinel as the ProjectSentinelDaemon scheduled task (runs start.bat at boot as a service account). Alternative to IIS. |
| `LICENSE` | Licence. |
| `package-lock.json` | Locked dependency versions (npm ci uses this). |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `README.md` | Architecture diagram and a summary of each function. |
| `start.bat` | Starts Sentinel on Windows: installs dependencies and builds the front end if missing, then runs npm run start. |
| `status_service.ps1` | Shows the state of the ProjectSentinelDaemon scheduled task and calls /api/health on port 3001. 1. Check Scheduled Task 2. Check Port 3001 Listener 3. Check HTTP Health |
| `stop_service.bat` | Stops the ProjectSentinelDaemon scheduled task and any process listening on port 3001. |
| `uninstall_service.ps1` | Stops and removes the ProjectSentinelDaemon scheduled task created by install_service.ps1. Auto-elevate to Administrator if not already elevated Terminate any lingering node server on port 3001 |
| `web.config` | IIS configuration: runs node backend\server.js through HttpPlatformHandler, sets NODE_ENV and PORT, enables WebSockets. |

### `agent/`

| File | What it does |
|---|---|
| `otelcol-builder.yaml` | Builder manifest for the custom OpenTelemetry collector binary. |

### `agent/config/`

OpenTelemetry collector configuration per platform.

| File | What it does |
|---|---|
| `collector-k8s.yaml` | OpenTelemetry collector config for Kubernetes nodes. |
| `collector-linux.yaml` | OpenTelemetry collector config for Linux hosts. |
| `collector-windows.yaml` | OpenTelemetry collector config for Windows hosts. |

### `agent/osquery/`

osquery configuration and flags (Linux and Windows).

| File | What it does |
|---|---|
| `osquery.conf` | osquery configuration (Linux). |
| `osquery.flags` | osquery flags (Linux). |
| `osquery.windows.conf` | osquery configuration (Windows). |
| `osquery.windows.flags` | osquery flags (Windows). |

### `agent/osquery/packs/`

osquery query packs: file changes, system inventory, security.

| File | What it does |
|---|---|
| `file-changes-windows.conf` | osquery pack file-changes-windows (generated by scripts/generate_osquery_pack.js where noted). |
| `file-changes.conf` | osquery pack file-changes (generated by scripts/generate_osquery_pack.js where noted). |
| `sentinel-security.conf` | osquery pack sentinel-security (generated by scripts/generate_osquery_pack.js where noted). |
| `system-inventory-windows.conf` | osquery pack system-inventory-windows (generated by scripts/generate_osquery_pack.js where noted). |
| `system-inventory.conf` | osquery pack system-inventory (generated by scripts/generate_osquery_pack.js where noted). |

### `agent/packaging/`

Packaging of the agent.

| File | What it does |
|---|---|
| `nfpm.yaml` | nfpm definition for the RPM and DEB packages. |
| `probe.json.example` | Example to copy and fill in (probe.json). |

### `agent/packaging/scripts/`

Build, sign and install/remove scripts for the packages.

| File | What it does |
|---|---|
| `build-packages.sh` | Stages and builds the SENTINEL agent packages: - Linux RPM + DEB with nfpm (collector, sentinel-probe, osquery, systemd units) - Windows MSI with WiX v4 when `wix` is on PATH - CycloneDX… |
| `postinstall.sh` | Sentinel-agent postinstall: service user, log dir for osquery, enable units. |
| `preremove.sh` | Sentinel-agent preremove: stop and disable the units. |
| `sign-packages.sh` | Sign RPM/DEB/MSI binaries using corporate code-signing certificates RPM GPG sign Windows Signtool |

### `agent/packaging/systemd/`

Linux service units (resource-limited).

| File | What it does |
|---|---|
| `sentinel-agent.service` | systemd unit for the OpenTelemetry collector (CPU and memory limited). |
| `sentinel-osquery.service` | systemd unit for osquery. |
| `sentinel-probe.service` | systemd unit for the Sentinel probe. |

### `agent/packaging/wix/`

Windows MSI definition.

| File | What it does |
|---|---|
| `sentinel-agent.wxs` | WiX definition of the Windows MSI. |

### `agent/probe/`

The Sentinel probe that runs on each host.

| File | What it does |
|---|---|
| `index.js` | SENTINEL Local Prober (sentinel-probe): Measures local application health (localhost URL), NAS read/write/list/stat latency on mounted shares, and exports standard OTLP metrics. |

### `agent/sql/`

Database receiver configs for the collector.

| File | What it does |
|---|---|
| `oracle.yaml` | Oracle receiver config. |
| `postgresql.yaml` | PostgreSQL receiver config. |
| `sqlserver.yaml` | SQL Server receiver config. |

### `ai_analysis/`

| File | What it does |
|---|---|
| `alert_engine.js` | Alert Engine & Lifecycle Management Evaluates rules of type threshold, baseline, absence, composite, and journey_failure. |
| `baselines.js` | Hour-of-Week Baselines Engine Computes and tracks median and MAD (Median Absolute Deviation) per (env, entity, metric, hour-of-week 0..167) over a 4-week lookback window. |
| `change_points.js` | Change-Point Detection Engine (CUSUM) Detects structural step-changes in journey step p95 timings and key metrics. |
| `index.js` | Entry point of the analysis package: exposes the analyzer, predictive checks, RCA engine, rota service, baselines, change points, alert engine and scorecard. |
| `llm_client.js` | Internal LLM Assistant Client Calls the bank's internal OpenAI-compatible endpoint. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `predictive.js` | Predictive checks: warns when a metric trends toward its threshold. |
| `rca_analytics_engine.js` | Root-cause analysis: builds RCA flows from alerts and events. |
| `real_analyzer.js` | Log and metric anomaly detection: rolling baselines with z-scores, and error-pattern detection in server logs. |
| `scorecard.js` | Weekly Product Scorecard Generator Builds availability %, journey step p95 vs last week, change points, top causes, and open CVEs per product. |
| `team_rota_service.js` | On-call rota: loads, edits and saves the team rotas (.runtime/team_rota.json). |

### `analytics/`

| File | What it does |
|---|---|
| `forecast.js` | Phase O1 / O1.3 Capacity & Forecast Helper: linearRunway(points, limit) Computes linear regression trend over 7-day and 30-day windows to forecast days until resource limit is reached. |

### `analytics/sentinelql/`

| File | What it does |
|---|---|
| `compiler.js` | Compiles a SentinelQL AST into a secure, parameterised ClickHouse SQL query. |
| `constants.js` | Allow-lists and constraints for SentinelQL lexer, parser, and ClickHouse compiler. |
| `index.js` | SentinelQL Public API: Lexer, Parser, Parameterised ClickHouse Compiler & Executor. |
| `lexer.js` | Robust, hand-written tokenizer for SentinelQL. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `parser.js` | Recursive descent parser constructing an AST from SentinelQL tokens. |

### `backend/`

| File | What it does |
|---|---|
| `audit_logger.js` | Append-only audit log of every mutating API call: written to logs/sentinel_audit.log (and PostgreSQL when configured), read back by the governance and admin views. |
| `cors_validator.js` | Strict CORS origin validator for Sentinel API. |
| `server.js` | Sentinel backend entry point (node backend/server.js). |
| `tracing.js` | W3C trace context: creates or continues a traceparent for every request and returns it in the response headers. |

### `backend/auth/`

Sign-in, sessions, roles, read policy and ingest keys.

| File | What it does |
|---|---|
| `access_policy.js` | Read access and environment entitlement policy. |
| `ingest_keys.js` | Ingest API keys. Every telemetry push (OTLP metrics and logs, shipper heartbeat, the custom metrics API) presents a key in `X-Sentinel-Api-Key` (or `Authorization: ApiKey <key>`). |
| `ldap_client.js` | Sign-in against LDAP / eLDAP: binds as the user, reads group membership and maps it to a Sentinel role. |
| `require_role.js` | Shared role guard. Relies on requireAuth (server.js) having set req.user from the session cookie or Bearer token, and on its CSRF check for cookie sessions. |
| `session.js` | Session tokens: HMAC-signed JWTs with key rotation (current and previous secret), verification and revocation. |

### `backend/config/`

Configuration package (@sentinel/config).

| File | What it does |
|---|---|
| `config.js` | Runtime configuration derived from config/global.yaml and environment variables: active environment, prod/staging URLs (with PROD_/STG_ overrides), collector mode and telemetry provider. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `simulations.js` | Simulation state manager for Intelligent Observability & Autonomous Recovery Framework Active fault simulations by component. |
| `yaml_config.js` | Loads, validates and saves the YAML configuration: config/global.yaml, config/apps/*.yaml (application manifests) and config/infra/*.yaml (infrastructure layers). |

### `backend/config/cyberark/`

CyberArk credential lookup.

| File | What it does |
|---|---|
| `credential_provider.js` | Credential lookup for every integration: finds the safe/object in config/cyberark.yaml, fetches it through CyberArk (cached), and falls back to an <APPID>_<PURPOSE> environment variable. |
| `cyberark_client.js` | Runs scripts/cyberark_fetch.py to read one secret from the CyberArk Central Credential Provider and returns its value. |

### `backend/demo/fixtures/`

Sample data for the Demo view only. Real views never read these files.

| File | What it does |
|---|---|
| `alerts.js` | Demo sample data: alerts (used only by the Demo view). |
| `apm.js` | Demo sample data: apm (used only by the Demo view). |
| `avi.js` | Demo sample data: avi (used only by the Demo view). |
| `console_common.js` | Demo sample data: console common (used only by the Demo view). |
| `console_compliance.js` | Demo sample data: console compliance (used only by the Demo view). |
| `console_dependencies.js` | Demo sample data: console dependencies (used only by the Demo view). |
| `console_geo.js` | Demo sample data: console geo (used only by the Demo view). |
| `console_jenkins.js` | Demo sample data: console jenkins (used only by the Demo view). |
| `console_overview.js` | Demo sample data: console overview (used only by the Demo view). |
| `console_reports.js` | Demo sample data: console reports (used only by the Demo view). |
| `correlation.js` | Demo sample data: correlation (used only by the Demo view). |
| `dashboards.js` | Demo sample data: dashboards (used only by the Demo view). |
| `databases.js` | Demo sample data: databases (used only by the Demo view). |
| `evidence.js` | Demo sample data: evidence (used only by the Demo view). |
| `expiry.js` | Demo sample data: expiry (used only by the Demo view). |
| `governance.js` | Demo sample data: governance (used only by the Demo view). |
| `home.js` | Demo sample data: home (used only by the Demo view). |
| `hosts.js` | Demo sample data: hosts (used only by the Demo view). |
| `kubernetes.js` | Demo sample data: kubernetes (used only by the Demo view). |
| `problems.js` | Demo sample data: problems (used only by the Demo view). |
| `products.js` | Demo sample data: products (used only by the Demo view). |
| `topology.js` | Demo sample data: topology (used only by the Demo view). |

### `backend/jobs/`

Background jobs, run on the leader node by the scheduler.

| File | What it does |
|---|---|
| `alert_rules.js` | Every 60 s (leader only): evaluates config/alerts/*.yaml for each environment and creates or updates alerts through db.addAlert. |
| `avi_overhead.js` | Computes AVI overhead per product and minute: VIP total time minus the agent-measured localhost time. |
| `change_points.js` | Every 15 minutes: CUSUM scan of the last 24 h of journey step times and key product metrics; records sudden level changes as events. |
| `cve_scan.js` | Daily, leader only. SENTINEL's own scan (no Tanium): - SBOMs are dropped by the agents / Jenkins jobs under <security.cve_scan.sbom_dir>/<env>/<product>/<host>.json (CycloneDX or SPDX JSON)… |
| `expiry_sync.js` | Certificate & Licence Inventory Synchronization. |
| `fleet_health.js` | Every 60 s on the leader: opens one alert per host whose agent stopped sending heartbeats or runs an unexpected version; resolves it when cleared. |
| `index.js` | Wires the background jobs P1–P10 into one scheduler. |
| `job_config.js` | Reads `jobs:` from config/global.yaml. |
| `problem_grouping.js` | Every 60 s on the leader: groups active alerts into problems by component and topology, attaches evidence and notifies Teams. |
| `scheduler.js` | Small in-process job scheduler. |
| `scorecard_weekly.js` | Weekly (Monday 06:00 by default): builds each product scorecard from stored data, saves it and sends it to Teams. |
| `stale_processes.js` | Stale Process & Service Detector Job. |
| `url_checks.js` | Manifest URL Validity & Integrity Checker. |
| `vip_probes.js` | Probes every product VIP (`layers.vip` / `endpoints.<env>.vip`) through AVI. |

### `backend/routes/`

API routes, one file per area.

| File | What it does |
|---|---|
| `_prototype.js` | Prototype-view guard. Some views were built as UI prototypes with sample data. |
| `agentRoutes.js` | SENTINEL Agent Dynamic Configuration API Serves host-specific OpenTelemetry and sentinel-probe configurations. |
| `alertRoutes.js` | Alert Lifecycle Management Routes Endpoints for open, ack, snooze, and resolve (Role SRE Lead+, audited). |
| `apmRoutes.js` | APM routes (/api/apm): answer DATA_UNAVAILABLE until an APM source is connected. |
| `appMapRoutes.js` | Application Map API GET /api/v2/apps/:id/map?from&to Ordered layers: Users → DNS → AVI VIP → SSO → app servers (hosts/pods) → storage → DB → dependencies Each node includes: kind, id, name,… |
| `changeRoutes.js` | File-Change Monitoring & SENTINEL Change Window Matching |
| `componentRoutes.js` | Phase O1 / O1.2 Component Metrics API: GET /api/v2/components/:kind/:id/metrics?from&to&step Reads metric catalogue from config/component_metrics.yaml. |
| `consoleRoutes.js` | Observability console (live). |
| `customMetricsRoutes.js` | POST /api/v1/metrics/ingest — custom metrics. |
| `dashboardRoutes.js` | Dashboard Builder REST API Audited CRUD operations, schema validation, and JSON export/import. |
| `databaseRoutes.js` | Enterprise Database Telemetry Views (Oracle, SQL Server, PostgreSQL) Reads the metrics emitted by the otelcol-contrib `postgresql`, `oracledb` and `sqlserver` receivers from the ClickHouse… |
| `demoRoutes.js` | Router for the isolated Demo view (/api/demo). |
| `evidenceRoutes.js` | Enterprise Evidence Packs API Generates self-contained HTML and PDF evidence packs for incident post-mortems and external review. |
| `expiryRoutes.js` | Certificates, Licences & URL Validity Routes. |
| `fleetRoutes.js` | Fleet view data (Govern › Agents and Observe › Hosts). |
| `governanceRoutes.js` | Governance routes: pending four-eyes approvals and the audit trail. |
| `healthCheckRoutes.js` | Health Checks API Restores Enterprise Health Matrix using the synthetics runner. |
| `infraRoutes.js` | Infrastructure API: host lists (Linux/Windows) with latest CPU, memory, disk and agent state, host detail, processes, and Kubernetes clusters/nodes/pods. |
| `k8sRoutes.js` | Kubernetes routes: clusters, nodes and pods from the inventory and ClickHouse. |
| `llmRoutes.js` | Internal LLM Assistant Routes Read-only operational explanations and evidence pack drafting with full audit logging. |
| `perimeterRoutes.js` | Perimeter routes (/api/perimeter, /api/avi): VIP probe telemetry and AVI data. |
| `platformRoutes.js` | Platform Health API Combines ingest health, background jobs status, ClickHouse write lag & rejected batches, ingest keys last seen, collector circuit-breaker states, and leader node into a… |
| `productRoutes.js` | Product toolchain inventory, Golden Journey metrics, execution runs, and failure screenshot artifact endpoints. |
| `queryRoutes.js` | SentinelQL Query API Audited, read-only analytics endpoint compiling SentinelQL to parameterised ClickHouse SQL. |
| `reportRoutes.js` | Monthly Reliability Report API Computes: - Overall Toolchain Availability % - MTTD (Mean Time to Detect in minutes) - MTTR (Mean Time to Resolve in minutes from SENTINEL problems) - Total… |
| `securityRoutes.js` | Security view over the ClickHouse `cve_findings` table (written by the P9 CVE scan job). |
| `storageRoutes.js` | Storage view (Observe > Storage). |
| `topologyRoutes.js` | Multi-layer topology extraction API: GET /api/v2/topology/:productId?environment= Traverses topology graph VIP -> Product -> Hosts -> Shares -> Databases. |
| `traceRoutes.js` | Trace Explorer API Queries distributed spans from ClickHouse (or memory store) and serves trace listings and trace waterfall details. |

### `backend/services/`

Services used by routes and jobs.

| File | What it does |
|---|---|
| `dashboardService.js` | Dashboard Builder Service Manages dashboard persistence in PostgreSQL with in-memory fallback, JSON schema validation, and file-based export/import syncing with config/dashboards/. |
| `html.js` | Safe HTML escaping utility for server-rendered HTML reports and templates (Evidence Packs, Weekly Scorecards, ServiceNow payload snippets). |

### `backend/services/health/`

| File | What it does |
|---|---|
| `healthCalculator.js` | Enterprise Health Scoring & Component Status Engine Isolated, deterministic calculation of system health index and component states. |

### `backend/services/ingest/`

| File | What it does |
|---|---|
| `line_protocol.js` | Custom metrics line protocol parser. |

### `backend/services/notify/`

| File | What it does |
|---|---|
| `teams.js` | Microsoft Teams Incoming Webhook Notification Provider Formats structured problem notification cards with link to SENTINEL. |

### `backend/services/slo/`

| File | What it does |
|---|---|
| `slo_tracker.js` | SLO tracking: loads SLO definitions and evaluates them against stored metrics. |

### `backend/services/telemetry/`

| File | What it does |
|---|---|
| `uptimeResolver.js` | Enterprise Cluster & Host Uptime Resolver Calculates true infrastructure uptime instead of transient Node.js process runtime. |

### `ci/`

| File | What it does |
|---|---|
| `Jenkinsfile` | CI pipeline: install, lint, test, build. |

### `config/`

| File | What it does |
|---|---|
| `.env.example` | Example environment variables for the config folder. |
| `component_metrics.yaml` | Metric catalogue per component kind for the component pages. |
| `correlation.yaml` | Correlation rules (which layer explains which symptoms). |
| `custom_checks.yaml` | Custom checks. |
| `cyberark.yaml` | CyberArk registry: safe and object name per application and purpose (no secrets). |
| `dynatrace_metric_aliases.yaml` | Maps Sentinel metric names to Dynatrace metric selectors. |
| `global.yaml` | Global settings: environment, prod/staging URLs, LDAP, collectors, security, jobs, fleet size, ClickHouse, log archive, enabled views. |
| `README.md` | How to add, change or remove an application manifest. |
| `slos.yaml` | SLO definitions. |
| `telemetry.yaml` | Telemetry profile: which sources (OTLP, Dynatrace, node exporter) are used. |
| `ui.yaml` | Front-end settings. |

### `config/alerts/`

| File | What it does |
|---|---|
| `rules.yaml` | Alert rules (threshold, duration, severity). |

### `config/apps/`

One manifest per application. Add a file here to add an application.

| File | What it does |
|---|---|
| `_TEMPLATE.yaml` | Template for a new application manifest (copy it, never loaded). |
| `aquasec.yaml` | Application manifest for aquasec: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `argocd.yaml` | Application manifest for argocd: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `argoworkflows.yaml` | Application manifest for argoworkflows: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `auto-remediation-service.yaml` | Application manifest for auto-remediation-service: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `bitbucket-external.yaml` | Application manifest for bitbucket-external: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `bitbucket.yaml` | Application manifest for bitbucket: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `cloudbees-jenkins.yaml` | Application manifest for cloudbees-jenkins: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `code-review-service.yaml` | Application manifest for code-review-service: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `fortify.yaml` | Application manifest for fortify: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `github.yaml` | Application manifest for github: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `jetbrains-teamcity.yaml` | Application manifest for jetbrains-teamcity: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `jfrog-artifactory.yaml` | Application manifest for jfrog-artifactory: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `mcp-server-k8s.yaml` | Application manifest for mcp-server-k8s: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `nexusiq.yaml` | Application manifest for nexusiq: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `otkr.yaml` | Application manifest for otkr: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `performance-center.yaml` | Application manifest for performance-center: endpoints per environment, auth, layers, hosts, journeys, certificates. |
| `sonarqube.yaml` | Application manifest for sonarqube: endpoints per environment, auth, layers, hosts, journeys, certificates. |

### `config/dashboards/`

| File | What it does |
|---|---|
| `infrastructure.json` | Built-in infrastructure dashboard. |
| `overview.json` | Built-in overview dashboard. |

### `config/infra/`

One file per infrastructure layer.

| File | What it does |
|---|---|
| `avi.yaml` | Infrastructure layer avi: endpoints and hosts for this layer. |
| `docker.yaml` | Infrastructure layer docker: endpoints and hosts for this layer. |
| `k8s.yaml` | Infrastructure layer k8s: endpoints and hosts for this layer. |
| `nfs.yaml` | Infrastructure layer nfs: endpoints and hosts for this layer. |
| `sso-eldap.yaml` | Infrastructure layer sso-eldap: endpoints and hosts for this layer. |
| `unix.yaml` | Infrastructure layer unix: endpoints and hosts for this layer. |
| `windows.yaml` | Infrastructure layer windows: endpoints and hosts for this layer. |

### `correlation/`

| File | What it does |
|---|---|
| `index.js` | Correlation engine: finds shared infrastructure behind symptoms, diagnoses which layer failed, and groups alerts into problems. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `problem_store.js` | Problems live in the Postgres `problem` table (migration 015) so both app nodes read the same list. |

### `database/`

| File | What it does |
|---|---|
| `clickhouse.js` | Minimal ClickHouse HTTP-interface client (port 8123). |
| `db.js` | Main data store used by the app: alerts, metrics, recoveries and settings, kept in memory, saved to .runtime/sentinel_db.json and, when configured, written to PostgreSQL and ClickHouse. |
| `event_store.js` | Event and RCA-hypothesis store (PostgreSQL / ClickHouse, with an in-memory buffer). |
| `expiry_store.js` | Real TLS, Secret, and License Expiry Datastore. |
| `leader_lock.js` | Collector leader election across the two SENTINEL app nodes. |
| `log_store.js` | Log store: appends, searches and aggregates logs (ClickHouse / PostgreSQL, with an in-memory buffer). |
| `migrate.js` | PostgreSQL migration runner (npm run migrate): applies database/migrations in order. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `postgres_users.js` | User and role store in PostgreSQL; a JSON file is used only outside production. |
| `postgres.js` | PostgreSQL connection pool (created only when db_jdbc is set) and metric read/write helpers. |
| `snowflake.js` | Optional Snowflake log analytics (staging configuration). |

### `database/clickhouse/migrations/`

ClickHouse migrations (npm run clickhouse:migrate).

| File | What it does |
|---|---|
| `001_metrics.sql` | ClickHouse migration 001: metrics tables. |
| `002_logs.sql` | ClickHouse migration 002: logs tables. |
| `003_spans.sql` | ClickHouse migration 003: spans tables. |
| `004_otel_traces.sql` | ClickHouse migration 004: otel traces tables. |
| `005_events_change_points_inventory.sql` | ClickHouse migration 005: events change points inventory tables. |
| `006_cve_findings.sql` | ClickHouse migration 006: cve findings tables. |
| `007_baselines.sql` | ClickHouse migration 007: baselines tables. |
| `008_expiry_items.sql` | ClickHouse migration 008: expiry items tables. |

### `database/migrations/`

PostgreSQL migrations (npm run migrate). Each has a .down.sql to roll back.

| File | What it does |
|---|---|
| `001_create_entity_schema.down.sql` | PostgreSQL migration 001: create entity schema (rollback). |
| `001_create_entity_schema.sql` | PostgreSQL migration 001: create entity schema. |
| `002_create_metric_storage.down.sql` | PostgreSQL migration 002: create metric storage (rollback). |
| `002_create_metric_storage.sql` | PostgreSQL migration 002: create metric storage. |
| `003_create_log_schema.down.sql` | PostgreSQL migration 003: create log schema (rollback). |
| `003_create_log_schema.sql` | PostgreSQL migration 003: create log schema. |
| `004_create_event_schema.down.sql` | PostgreSQL migration 004: create event schema (rollback). |
| `004_create_event_schema.sql` | PostgreSQL migration 004: create event schema. |
| `005_create_expiry_schema.down.sql` | PostgreSQL migration 005: create expiry schema (rollback). |
| `005_create_expiry_schema.sql` | PostgreSQL migration 005: create expiry schema. |
| `006_create_user_audit_schema.down.sql` | PostgreSQL migration 006: create user audit schema (rollback). |
| `006_create_user_audit_schema.sql` | PostgreSQL migration 006: create user audit schema. |
| `007_create_alerts_and_recovery_runs.down.sql` | PostgreSQL migration 007: create alerts and recovery runs (rollback). |
| `007_create_alerts_and_recovery_runs.sql` | PostgreSQL migration 007: create alerts and recovery runs. |
| `008_create_model_decisions.down.sql` | PostgreSQL migration 008: create model decisions (rollback). |
| `008_create_model_decisions.sql` | PostgreSQL migration 008: create model decisions. |
| `009_create_immutable_audit_events.down.sql` | PostgreSQL migration 009: create immutable audit events (rollback). |
| `009_create_immutable_audit_events.sql` | PostgreSQL migration 009: create immutable audit events. |
| `010_create_ingest_api_keys.down.sql` | PostgreSQL migration 010: create ingest api keys (rollback). |
| `010_create_ingest_api_keys.sql` | PostgreSQL migration 010: create ingest api keys. |
| `011_create_revoked_tokens.down.sql` | PostgreSQL migration 011: create revoked tokens (rollback). |
| `011_create_revoked_tokens.sql` | PostgreSQL migration 011: create revoked tokens. |
| `012_add_gateway_allowed_environments.down.sql` | PostgreSQL migration 012: add gateway allowed environments (rollback). |
| `012_add_gateway_allowed_environments.sql` | PostgreSQL migration 012: add gateway allowed environments. |
| `013_create_change_windows.down.sql` | PostgreSQL migration 013: create change windows (rollback). |
| `013_create_change_windows.sql` | PostgreSQL migration 013: create change windows. |
| `014_extend_alerts_lifecycle.down.sql` | PostgreSQL migration 014: extend alerts lifecycle (rollback). |
| `014_extend_alerts_lifecycle.sql` | PostgreSQL migration 014: extend alerts lifecycle. |
| `015_create_problems.down.sql` | PostgreSQL migration 015: create problems (rollback). |
| `015_create_problems.sql` | PostgreSQL migration 015: create problems. |
| `016_create_scorecards.down.sql` | PostgreSQL migration 016: create scorecards (rollback). |
| `016_create_scorecards.sql` | PostgreSQL migration 016: create scorecards. |
| `017_create_dashboards.down.sql` | PostgreSQL migration 017: create dashboards (rollback). |
| `017_create_dashboards.sql` | PostgreSQL migration 017: create dashboards. |
| `018_scorecard_nullable_metrics.down.sql` | PostgreSQL migration 018: scorecard nullable metrics (rollback). |
| `018_scorecard_nullable_metrics.sql` | PostgreSQL migration 018: scorecard nullable metrics. |
| `019_change_window_close.down.sql` | PostgreSQL migration 019: change window close (rollback). |
| `019_change_window_close.sql` | PostgreSQL migration 019: change window close. |

### `deployments/`

| File | What it does |
|---|---|
| `Jenkinsfile` | Deployment pipeline. |

### `deployments/ansible/`

Ansible: agent install (Linux and Windows), rollout waves, rollback, telemetry playbooks.

| File | What it does |
|---|---|
| `inventory.ini` | Ansible inventory (fill per environment; see inventory.ini.example). |
| `inventory.ini.example` | Example to copy and fill in (inventory.ini). |
| `playbook_fluentbit.yml` | Installs Fluent Bit log shipper on Linux. |
| `playbook_linux_node_exporter.yml` | Installs Prometheus node exporter on Linux. |
| `playbook_linux_otel.yml` | Installs the OpenTelemetry collector on Linux. |
| `playbook_linux_telemetry.yml` | Installs the Linux telemetry bundle. |

### `deployments/ansible/group_vars/`

| File | What it does |
|---|---|
| `all.yml.example` | Example to copy and fill in (all.yml). |
| `windows_servers.yml.example` | Example to copy and fill in (windows_servers.yml). |

### `deployments/ansible/playbooks/`

| File | What it does |
|---|---|
| `deploy_sentinel_agent.yml` | Agent rollout in waves (pilot, toolchain, databases, rest). |
| `install_sentinel_agent.yml` | Installs the Sentinel agent on Linux and Windows hosts. |
| `rollback_sentinel_agent.yml` | Rolls the agent back. |

### `deployments/ansible/roles/sentinel_agent_linux/defaults/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_linux: defaults. |

### `deployments/ansible/roles/sentinel_agent_linux/handlers/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_linux: handlers. |

### `deployments/ansible/roles/sentinel_agent_linux/tasks/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_linux: tasks. |

### `deployments/ansible/roles/sentinel_agent_windows/defaults/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_windows: defaults. |

### `deployments/ansible/roles/sentinel_agent_windows/handlers/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_windows: handlers. |

### `deployments/ansible/roles/sentinel_agent_windows/tasks/`

| File | What it does |
|---|---|
| `main.yml` | Ansible role sentinel_agent_windows: tasks. |

### `deployments/examples/`

| File | What it does |
|---|---|
| `github-nas-probe.yaml` | Example: NAS probe from a GitHub Actions workflow. |
| `jenkins-nas-probe.Jenkinsfile` | Example: NAS probe from a Jenkins pipeline. |

### `deployments/fluentbit_configs/`

| File | What it does |
|---|---|
| `fluentbit_base.conf` | Enterprise Fluent Bit Base Configuration Features: Persistent Tail, Redaction Filters (PANs, Tokens, PII), Sentinel Ingest Redaction Filters |
| `parsers.conf` | Fluent Bit log parsers. |

### `deployments/k8s/`

Kubernetes: agent DaemonSet (plain manifest) and Helm chart.

| File | What it does |
|---|---|
| `fluentbit_daemonset.yaml` | Fluent Bit log shipper as a Kubernetes DaemonSet. |
| `otel_collector_daemonset.yaml` | OpenTelemetry collector as a Kubernetes DaemonSet (older alternative to the sentinel-agent chart). |
| `prometheus_node_exporter_daemonset.yaml` | Prometheus node exporter as a Kubernetes DaemonSet. |
| `sentinel-agent-plain.yaml` | SENTINEL agent for Kubernetes, as plain manifests (no Helm). |

### `deployments/k8s/sentinel-agent/`

| File | What it does |
|---|---|
| `Chart.yaml` | Helm chart definition of the Sentinel agent. |
| `values.yaml` | SENTINEL agent for Kubernetes. |

### `deployments/k8s/sentinel-agent/templates/`

| File | What it does |
|---|---|
| `_helpers.tpl` | Helm template _helpers.tpl. |
| `cluster-deployment.yaml` | Helm template cluster-deployment.yaml. |
| `daemonset.yaml` | Helm template daemonset.yaml. |
| `rbac.yaml` | Helm template rbac.yaml. |

### `deployments/opentelemetry_configs/`

| File | What it does |
|---|---|
| `otel_linux_config.yaml` | OpenTelemetry collector config for Linux (direct to Sentinel). |
| `otel_windows_config.yaml` | OpenTelemetry collector config for Windows (direct to Sentinel). |

### `deployments/otel-gateway/`

| File | What it does |
|---|---|
| `install_otel_gateway.ps1` | OpenTelemetry Collector gateway installation Installs otelcol-contrib.exe as the Windows service "SentinelOtelGateway" on a SENTINEL node. |
| `otel-gateway.yaml` | SENTINEL OpenTelemetry Collector gateway (otelcol-contrib) Runs on both SENTINEL Windows nodes as the "SentinelOtelGateway" service. |
| `uninstall_otel_gateway.ps1` | OpenTelemetry Collector gateway removal Stops and deletes the SentinelOtelGateway service and its firewall rules. |

### `deployments/powershell/`

| File | What it does |
|---|---|
| `deploy_fluentbit.ps1` | Deploys Fluent Bit Log Shipper as a Windows Service on Enterprise Windows Compute Nodes. |
| `deploy_windows_exporter.ps1` | Deploys Prometheus windows_exporter on Windows Server fleet. |
| `deploy_windows_otel.ps1` | Deploys OpenTelemetry Collector on Windows Server fleet via PowerShell / SCCM. |
| `deploy_windows_telemetry.ps1` | Unified Windows Telemetry Exporter Installer for Project Sentinel. |

### `deployments/windows/`

| File | What it does |
|---|---|
| `install_service.ps1` | Project Sentinel Windows Service Deployment Helper Forwards execution to the canonical installation script located at the repository root. |
| `start.bat` | Windows Deployment Launcher (Forwarder) Executes canonical start.bat from the repository root. |

### `docs/`

| File | What it does |
|---|---|
| `CODEBASE_MAP.md` | This file. |
| `jira_production_readiness.csv` | The readiness tasks as a Jira CSV import. |
| `PRODUCTION_READINESS_PLAN.md` | Production readiness plan: tasks with file, line and sample values. |

### `frontend/`

| File | What it does |
|---|---|
| `.gitignore` | Files git ignores in the front end. |
| `.oxlintrc.json` | Front-end lint rules (oxlint). |
| `index.html` | HTML page that loads the front-end bundle. |
| `package-lock.json` | Locked front-end dependency versions. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `tsconfig.json` | Editor type-checking settings for the front end. |
| `vite.config.js` | Vite build configuration for the front end (React plugin, dev proxy to the backend). |

### `frontend/public/`

| File | What it does |
|---|---|
| `favicon.svg` | Browser tab icon. |

### `frontend/src/`

Front-end source.

| File | What it does |
|---|---|
| `api.js` | Shared fetch helpers for the SENTINEL UI. |
| `App.css` | Styles for App. |
| `App.jsx` | Main application shell: sidebar navigation (NAV_GROUPS), URL routing, environment switch (PRD/STG/Demo), sign-in state, and which view is shown for the active tab. |
| `index.css` | Styles for index. |
| `main.jsx` | Front-end entry point: loads UI config, then mounts App into #root. |
| `maintenanceConfig.js` | Maintenance Notification Configuration The values here are DEFAULTS ONLY. |
| `tokens.css` | Styles for tokens. |

### `frontend/src/components/admin/`

| File | What it does |
|---|---|
| `AdminManagement.css` | Styles for AdminManagement. |
| `AdminManagement.jsx` | Admin view: users and roles, maintenance switches, and the preflight check, for Super Admins. |
| `PreflightCheckView.css` | Styles for PreflightCheckView. |
| `PreflightCheckView.jsx` | Runs the preflight check (reachability of every configured endpoint) and shows the result table. |

### `frontend/src/components/analytics/`

| File | What it does |
|---|---|
| `RcaDashboard.css` | Styles for RcaDashboard. |
| `RcaDashboard.jsx` | Root-cause analysis dashboard: correlated incidents and their probable cause. |

### `frontend/src/components/apps/`

| File | What it does |
|---|---|
| `AppMapView.css` | Styles for AppMapView. |
| `AppMapView.jsx` | Application map: each application with its layers (VIP, hosts, databases) and their health. |
| `ComponentRouter.jsx` | Switches between the application map and a single component page. |

### `frontend/src/components/capacity/`

| File | What it does |
|---|---|
| `CapacityView.css` | Styles for CapacityView. |
| `CapacityView.jsx` | Capacity view: used vs available capacity and runway forecast per resource. |

### `frontend/src/components/component/`

| File | What it does |
|---|---|
| `ComponentPage.css` | Styles for ComponentPage. |
| `ComponentPage.jsx` | Detail page for one component (host, service or database): time series, capacity, top-N and status grid. |

### `frontend/src/components/console/`

Observability console screens (/api/v2/console).

| File | What it does |
|---|---|
| `AppDetailScreen.jsx` | Console: per-application detail screen (metrics, hosts, endpoints, alerts, certificates). |
| `ComplianceScreen.jsx` | Console: compliance and lifecycle screen (certificate/licence expiry, licence usage). |
| `ConsolePrimitives.jsx` | Console building blocks shared by all console screens: header, KPI row, panels, pills, tables, charts, legends, empty state. |
| `ConsoleView.css` | Styles for ConsoleView. |
| `ConsoleView.jsx` | Console container: tab bar for the console screens, loads /api/v2/console/<screen> for the environment and handles app:<id> drill-down. |
| `DependenciesScreen.jsx` | Console: dependencies and probes screen (probe results by region, WAN chart). |
| `GeoScreen.jsx` | Console: geo replication screen (replication lag and mirror sync per region). |
| `JenkinsScreen.jsx` | Console: CloudBees Jenkins screen (controllers, executors, queue, agents) filtered by operations centre. |
| `OverviewScreen.jsx` | Console: platform overview (KPIs, application groups and their state, open alerts). |
| `ReportsScreen.jsx` | Console: SLO and reports screen (availability, root causes, DORA). |

### `frontend/src/components/correlation/`

| File | What it does |
|---|---|
| `BlastRadiusView.css` | Styles for BlastRadiusView. |
| `BlastRadiusView.jsx` | Blast radius view: RCA hypotheses, affected entities, and confirm/reject verdicts. |
| `DriftRcaCorrelationFeed.css` | Styles for DriftRcaCorrelationFeed. |
| `DriftRcaCorrelationFeed.jsx` | Feed of configuration-drift events correlated with RCA (currently shows an empty state). |
| `EntityDrillDownPanel.css` | Styles for EntityDrillDownPanel. |
| `EntityDrillDownPanel.jsx` | Side panel with details, relations and recent events for one entity. |
| `GlobalEntitySearch.css` | Styles for GlobalEntitySearch. |
| `GlobalEntitySearch.jsx` | Global search box (Ctrl+K) to find hosts, applications and services. |
| `UnifiedCorrelationTimeline.css` | Styles for UnifiedCorrelationTimeline. |
| `UnifiedCorrelationTimeline.jsx` | Timeline of correlated events (alerts, changes, deployments) across entities. |

### `frontend/src/components/database/`

| File | What it does |
|---|---|
| `DatabaseView.css` | Styles for DatabaseView. |
| `DatabaseView.jsx` | Databases view: per-database health, connections and storage from the database receivers. |

### `frontend/src/components/demo/`

| File | What it does |
|---|---|
| `DemoView.css` | Styles for DemoView. |
| `DemoView.jsx` | Demo view: renders the normal screens with built-in sample data (read-only) for presentations. |

### `frontend/src/components/expiry/`

| File | What it does |
|---|---|
| `ExpiryView.css` | Styles for ExpiryView. |
| `ExpiryView.jsx` | Certificates and licences view: expiry dates and days left. |

### `frontend/src/components/explore/`

| File | What it does |
|---|---|
| `DashboardBuilderView.css` | Styles for DashboardBuilderView. |
| `DashboardBuilderView.jsx` | Dashboard builder: create, edit and view custom dashboards. |
| `TracesView.css` | Styles for TracesView. |
| `TracesView.jsx` | Traces view: recent traces and their spans. |

### `frontend/src/components/fleet/`

| File | What it does |
|---|---|
| `FleetExplorerView.css` | Styles for FleetExplorerView. |
| `FleetExplorerView.jsx` | Fleet view: every host with agent status (reporting, silent, no agent) and agent version. |

### `frontend/src/components/govern/`

| File | What it does |
|---|---|
| `ChangeWindowsView.css` | Styles for ChangeWindowsView. |
| `ChangeWindowsView.jsx` | Change windows: list, create and close maintenance windows that suppress alerts. |
| `ConfigurationView.css` | Styles for ConfigurationView. |
| `ConfigurationView.jsx` | Configuration view: the effective configuration with secrets masked. |
| `PlatformHealthView.css` | Styles for PlatformHealthView. |
| `PlatformHealthView.jsx` | Platform health: Sentinel's own health (database, jobs, ingest queue, leader). |

### `frontend/src/components/governance/`

| File | What it does |
|---|---|
| `SodGovernanceBanner.css` | Styles for SodGovernanceBanner. |
| `SodGovernanceBanner.jsx` | Four-eyes approval banner: pending remediation actions and the sign buttons. |

### `frontend/src/components/health/`

| File | What it does |
|---|---|
| `HealthChecksView.css` | Styles for HealthChecksView. |
| `HealthChecksView.jsx` | Health checks view: results of endpoint and synthetic checks. |

### `frontend/src/components/home/`

| File | What it does |
|---|---|
| `HomeScorecardView.css` | Styles for HomeScorecardView. |
| `HomeScorecardView.jsx` | Home scorecard: product health tiles, open problems and quick links. |

### `frontend/src/components/infra/`

| File | What it does |
|---|---|
| `HostDetailView.css` | Styles for HostDetailView. |
| `HostDetailView.jsx` | Host detail page: CPU, memory, disk and processes for one host. |
| `HostListView.css` | Styles for HostListView. |
| `HostListView.jsx` | Host list (Linux or Windows) with filters and status. |

### `frontend/src/components/k8s/`

| File | What it does |
|---|---|
| `KubernetesMeshView.css` | Styles for KubernetesMeshView. |
| `KubernetesMeshView.jsx` | Kubernetes view: clusters, nodes (honeycomb), pods and workloads. |
| `NodeHoneycombMesh.jsx` | Honeycomb of Kubernetes nodes coloured by severity. |

### `frontend/src/components/navigation/`

| File | What it does |
|---|---|
| `NavIcons.jsx` | SVG icons used by the sidebar navigation (one icon set). |

### `frontend/src/components/perimeter/`

| File | What it does |
|---|---|
| `EdgePerimeterView.css` | Styles for EdgePerimeterView. |
| `EdgePerimeterView.jsx` | Edge / perimeter view: AVI virtual services, VIP timings and edge logs. |
| `LiveLogsStreamTable.jsx` | Table of recent edge log lines; a row can open its trace. |

### `frontend/src/components/product/`

| File | What it does |
|---|---|
| `ProductPage.css` | Styles for ProductPage. |
| `ProductPage.jsx` | Product page: golden journeys, step results and success trend for one product. |

### `frontend/src/components/respond/`

| File | What it does |
|---|---|
| `AlertsView.jsx` | Alerts view: open alerts with acknowledge and resolve actions. |
| `EvidencePacksView.jsx` | Evidence packs: download the evidence report for a problem. |
| `ProblemsView.jsx` | Problems view: open problems with affected entities and details. |
| `RemediationView.css` | Styles for RemediationView. |
| `RemediationView.jsx` | Remediation view: runbooks, their runs and approval state. |
| `Respond.css` | Styles for Respond. |

### `frontend/src/components/security/`

| File | What it does |
|---|---|
| `SecurityView.jsx` | Security view: vulnerability and scan findings per host and product. |

### `frontend/src/components/shared/`

Building blocks reused by many views.

| File | What it does |
|---|---|
| `CapacityBar.css` | Styles for CapacityBar. |
| `CapacityBar.jsx` | Bar showing used / available capacity, utilisation and runway. |
| `DataTable.jsx` | Sortable, dense table used by most views. |
| `DonutChart.css` | Styles for DonutChart. |
| `DonutChart.jsx` | Canvas donut chart. |
| `EmptyState.jsx` | Empty state shown when a view has no data, with the reason. |
| `EntityChip.jsx` | Small chip naming an entity (host, app, service); clickable to drill in. |
| `MaintenanceNotice.css` | Styles for MaintenanceNotice. |
| `MaintenanceNotice.jsx` | Banner and badge shown on views under maintenance. |
| `PrototypeNotice.css` | Styles for PrototypeNotice. |
| `PrototypeNotice.jsx` | Shared loading, data-unavailable and prototype states. |
| `ReactiveCanvasChart.css` | Styles for ReactiveCanvasChart. |
| `ReactiveCanvasChart.jsx` | Fast canvas line chart for dense time series. |
| `ReadOnlyActionButton.css` | Styles for ReadOnlyActionButton. |
| `ReadOnlyActionButton.jsx` | Button that is disabled in read-only (demo) mode with an explanation. |
| `SeverityPill.jsx` | Coloured pill for a severity (critical, high, medium, low). |
| `StatTile.jsx` | Metric tile: label, value and optional trend. |
| `StatusBadge.css` | Styles for StatusBadge. |
| `StatusBadge.jsx` | Status badge and dot coloured by severity/state. |
| `StatusGrid.css` | Styles for StatusGrid. |
| `StatusGrid.jsx` | Grid of status badges for a set of items. |
| `TelemetryView.css` | Styles for TelemetryView. |
| `TimePicker.jsx` | Time range picker (15m, 1h, 6h, 24h ...). |
| `TimeSeriesPanel.css` | Styles for TimeSeriesPanel. |
| `TimeSeriesPanel.jsx` | Panel wrapping a time-series chart with title and empty state. |
| `TopNTable.css` | Styles for TopNTable. |
| `TopNTable.jsx` | Table of the top N items by a metric. |
| `usePrototypeData.js` | React hook: fetches a view endpoint for the environment and returns { state, data, reason }. |

### `frontend/src/components/sre/`

| File | What it does |
|---|---|
| `MiscOperations.css` | Styles for MiscOperations. |
| `MiscOperations.jsx` | SRE tools: on-call rota and Dynatrace problem lookup. |
| `SloErrorBudget.css` | Styles for SloErrorBudget. |
| `SloErrorBudget.jsx` | SLO and error budget per service. |

### `frontend/src/components/storage/`

| File | What it does |
|---|---|
| `StorageView.css` | Styles for StorageView. |
| `StorageView.jsx` | Storage view: NAS/NFS shares with latency and status. |

### `frontend/src/router/`

| File | What it does |
|---|---|
| `useUrlRouter.js` | React hook keeping tab, environment and filters in the URL (back/forward work). |

### `inventory/`

| File | What it does |
|---|---|
| `entity_resolver.js` | Deterministic, stable entity ID resolver per Section 5. |
| `index.js` | Public API for @sentinel/inventory package. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `store.js` | Unified entity and graph edge repository supporting both PostgreSQL and resilient in-memory/JSON fallback with automatic synchronization. |

### `inventory/sources/`

| File | What it does |
|---|---|
| `avi_source.js` | Discovers AVI Vantage virtual services and pool members to build 'routes_through' relationship edges. |
| `jenkins_source.js` | Discovers live build agent fleet and controllers from CloudBees Jenkins / OC. |
| `k8s_source.js` | Discovers Kubernetes clusters, nodes, and pods. |
| `otlp_source.js` | Auto-registers host, service, and container entities from incoming OpenTelemetry resource attributes on first ingestion. |
| `teamcity_source.js` | Discovers build agents from JetBrains TeamCity REST API. |
| `vip_discovery.js` | Turns VIP probe results (DNS answers, certificate names) into topology: VIP resolves-to IP and VIP cert-name DNS entities. |
| `yaml_source.js` | Discovers and builds topology entities and relationship edges from declarative YAML application and infrastructure manifests. |

### `logger/`

| File | What it does |
|---|---|
| `logger.js` | Structured logging to rotating files (NAS log folder), with environment tags. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |

### `logs_collection/archival/`

| File | What it does |
|---|---|
| `s3_archiver.js` | Daily log archive: compresses old logs and uploads them to S3 (log_archive in config/global.yaml). |
| `s3_client.js` | Minimal S3 PUT with AWS Signature V4, using only Node's crypto and https. |

### `logs_collection/parser/`

| File | What it does |
|---|---|
| `log_parser.js` | Log parsing: normalises levels, extracts fields and builds message fingerprints for grouping. |

### `logs_collection/real/fluentd/`

| File | What it does |
|---|---|
| `fluentd_log_collector.js` | Tails log files written by Fluentd / Fluent Bit, parses them and stores them in the log store. |

### `metrics_collection/`

| File | What it does |
|---|---|
| `collector_coordinator.js` | Runs the metric collectors on their intervals (by tier), per environment, on the leader node, and feeds results to analysis and alerting. |
| `concurrency_limiter.js` | Executes an array of async task functions with a concurrency ceiling. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `source_arbiter.js` | Source arbiter. The same metric can arrive from several sources while Dynatrace is still in use: Dynatrace API, SENTINEL's own OTel agents, and SENTINEL probes. |
| `telemetry_provider_selector.js` | Telemetry profile manager: picks the source combination from config/telemetry.yaml and decides which collectors run. |

### `metrics_collection/real/applications/`

One collector per tool; loaded by app_collector.js from the manifests.

| File | What it does |
|---|---|
| `app_collector.js` | Runs the per-application collectors listed in the manifests and merges their metrics. |
| `argocd_collector.js` | ArgoCD GitOps Continuous Delivery Telemetry Collector. |
| `argoworkflows_collector.js` | Argo Workflows Engine Telemetry Collector. |
| `artifactory_collector.js` | JFrog Artifactory Storage & Artifact Repository Telemetry Collector. |
| `bitbucket_collector.js` | Atlassian Bitbucket Server Telemetry Collector. |
| `bitbucket_external_collector.js` | External Bitbucket Server Probe. |
| `fortify_collector.js` | Micro Focus Fortify SSC Telemetry Collector. |
| `github_collector.js` | GitHub Enterprise Server Telemetry Collector. |
| `jenkins_collector.js` | Collects CloudBees Jenkins metrics and polls the declared operations centres and controllers. |
| `jenkins_topology.js` | Per-controller Jenkins polling. |
| `mcp_collector.js` | MCP Gateway / Microservices Platform Telemetry Collector. |
| `nexusiq_collector.js` | Sonatype Nexus IQ Server Telemetry Collector. |
| `otkr_collector.js` | OTKR Security Scanner Telemetry Collector. |
| `performance_center_collector.js` | Performance Center Load Testing Telemetry Collector. |
| `sonarqube_collector.js` | SonarQube Code Quality & Static Analysis Telemetry Collector. |
| `teamcity_collector.js` | JetBrains TeamCity Build Server Telemetry Collector. |

### `metrics_collection/real/dynatrace/`

| File | What it does |
|---|---|
| `dynatrace_collector.js` | The Dynatrace API address for an environment: PROD_DYNATRACE_API_ENDPOINT / STG_DYNATRACE_API_ENDPOINT (like every other URL override), else prod_urls / stg_urls in config/global.yaml. |
| `metric_resolver.js` | Dynamic Dynatrace metric selector resolver. |
| `token_provider.js` | Dedicated short-lived (30-second) token provider for Dynatrace API v2. Features: - Single-flight lock preventing concurrent redundant mints - Strict 25s TTL enforcement (min(token_ttl - 5s,… |

### `metrics_collection/real/infrastructure/`

One collector per infrastructure layer; run by infra_collector.js.

| File | What it does |
|---|---|
| `avi_collector.js` | VMware NSX ALB (Avi Networks) Telemetry Collector. |
| `database_collector.js` | Database Infrastructure & Connection Pool Telemetry Collector. |
| `docker_collector.js` | Docker Container Registry & Runtime Telemetry Collector. |
| `infra_collector.js` | Runs every infrastructure collector (AVI, databases, Linux, Windows, NAS, S3, SSO, network) and merges the results. |
| `k8s_collector.js` | Kubernetes Infrastructure & Container Telemetry Collector. |
| `linux_collector.js` | Linux/Unix compute CPU, memory, and load telemetry collector. |
| `nas_collector.js` | Enterprise Storage (SAN/NAS/All-Flash) Telemetry Collector. |
| `network_collector.js` | Real network latency and packet loss collector via active TCP handshakes and VIP layer probers (DNS, TCP, TLS, TTFB, Total duration, cert expiry). |
| `node_exporter_collector.js` | Prometheus Node Exporter Telemetry Parser. |
| `s3_collector.js` | Object Storage / S3 Telemetry Collector. |
| `sso_collector.js` | Identity, eLDAP & SSO Telemetry Collector. |
| `windows_collector.js` | Windows Server Administration & IIS Telemetry Collector. |

### `metrics_collection/real/opentelemetry/`

| File | What it does |
|---|---|
| `otlp_metric_normalizer.js` | OpenTelemetry (OTLP) Semantic Convention Metric Normalizer Translates standard OTel metric names into Project Sentinel dashboard metrics (Supports OTel Hostmetrics, Process, JVM, Docker,… |

### `metrics_collection/real/probers/`

| File | What it does |
|---|---|
| `url_probe_collector.js` | Generic URL-Only Prober Collector for unowned systems without agents or APIs. |

### `metrics_collection/real/python_checks/`

| File | What it does |
|---|---|
| `runner.js` | Stand-in for the retired Python Selenium prober; always answers DATA_UNAVAILABLE (synthetics replaced it). |

### `metrics_collection/shared/`

| File | What it does |
|---|---|
| `circuit_breaker.js` | Circuit Breaker pattern implementation for telemetry collectors. |
| `collector_contract.js` | Collector Contract Standard response envelope and truthfulness contract for all Sentinel collectors. |
| `fetch_with_fallback.js` | Unified HTTP Fetch utility with authenticated credential injection, session management, 401 retry, bounded timeout, and distinct AUTH_FAILED detection. |
| `version_tracker.js` | Product version capture and change detection. |

### `metrics_collection/sources/`

| File | What it does |
|---|---|
| `telemetry_source.js` | Unified TelemetrySource interface. |

### `remediation/`

| File | What it does |
|---|---|
| `custom_checks.js` | Custom checks declared in YAML: runs them and records results. |
| `index.js` | Entry point of the remediation package: custom checks and recovery (runbooks). |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `recovery.js` | Autonomous recovery: chooses and runs runbooks under four-eyes approval, with a circuit breaker for Jenkins. |

### `remediation/integrations/`

| File | What it does |
|---|---|
| `servicenow_client.js` | Enterprise ServiceNow REST API Client & On-Call Dispatcher Bridges Sentinel Autonomous Recovery with enterprise ITSM change management. |

### `remediation/real/jenkins/`

| File | What it does |
|---|---|
| `jenkins_trigger.js` | Triggers a Jenkins self-healing job for a component and reports its progress. |

### `scripts/`

| File | What it does |
|---|---|
| `bootstrap.js` | Makes a fresh clone runnable with no manual setup: git clone ... |
| `clickhouse_migrate.js` | Apply database/clickhouse/migrations/NNN_*.sql in order over ClickHouse's HTTP interface, recording each applied version in <db>.schema_migrations. |
| `config_check.js` | Npm run config:check Validates everything under config/ and prints what each application will do when the app starts. |
| `cyberark_fetch.py` | Fetch one credential from CyberArk through the Central Credential Provider (CCP) REST API. |
| `dev_backend.js` | Starts the backend for local development with the Vite dev origins allowed by CORS (SENTINEL_ALLOW_LOCALHOST_CORS=true). |
| `generate_osquery_pack.js` | Builds the osquery file-change packs from the `watch:` paths in config/apps/*.yaml. |
| `generate_shipper_configs.js` | Generates per-host log shipper configurations directly from the Phase 1 entity model (@sentinel/inventory), ensuring paths, tags, and destinations are never hand-maintained. |
| `ingest_key.js` | Manage ingest API keys. |
| `lint_no_demo.js` | Lint:demo Fails if a file outside: - backend/demo/ - backend/routes/demoRoutes.js - frontend/src/components/demo/ - tests/ imports a demo fixture or contains an `env === 'demo'` style branch. |
| `lint_no_random.js` | Lint Script: Assert Zero Math.random() in real/ collector directories |
| `lint_no_sample_data.js` | Lint:samples — catches fabricated "real-looking" data outside demo code. |
| `lint_severity_constants.js` | Lightweight CI/CD verification rule flagging hardcoded inline severity / status comparisons and color maps across apps/web and apps/api. |
| `lint_unreferenced_components.js` | Fails when a file under frontend/src is not reachable through static or dynamic imports from frontend/src/main.jsx (dead screens must be deleted, not left behind). |
| `preflight_check.js` | Preflight Config & Endpoint Reachability Checker Walks every configured endpoint and reports: - REACHABLE: endpoint responded 200 OK - AUTH_FAILED: endpoint responded 401/403 or SSO… |
| `prod_readiness_check.js` | Production readiness check. |
| `run_tests.js` | Runs every test file listed in package.json "test:all", in order, stopping at the first failure. |
| `setup_symlinks.js` | Automatically verifies and links workspace packages into node_modules/@sentinel and ensures frontend dependencies (including Vite) and required modules are present. |
| `simulate_demo_injection.js` | Demo injection simulator. |
| `verify_dist.js` | Frontend/dist is committed so production hosts can run without the build toolchain. |

### `security/`

| File | What it does |
|---|---|
| `index.js` | Entry point of the security package (CVE scanner). |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `scanner.js` | Package and CVE findings processor |

### `shared/`

| File | What it does |
|---|---|
| `index.d.ts` | Type definitions of the shared constants. |
| `index.js` | Canonical single source of truth for severity, operational status, UI color mapping, health penalty weighting, and Incident Priority. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |

### `synthetics/`

| File | What it does |
|---|---|
| `index.js` | Project Sentinel Synthetics & Golden Journeys Package Entry Point. |
| `package.json` | npm package definition (name, entry point, scripts, dependencies). |
| `runner.js` | Golden Journey Synthetics Runner & Scheduler. |
| `trace.js` | Distributed W3C Trace and Metrics integration for Sentinel Golden Journeys. |

### `synthetics/steps/`

| File | What it does |
|---|---|
| `browser.js` | Headless Playwright browser journey step with failure screenshots. |
| `git.js` | Git probe step: ls-remote or shallow clone of a canary repo into a temp directory with cleanup. |
| `http.js` | HTTP step runner with millisecond-precision performance timing and assertions. |
| `jenkins.js` | Jenkins canary build step: queue wait and agent allocation from the build API. |
| `product_checks.js` | Per-product synthetic checks with canary accounts (Jenkins queue/executors, TeamCity queue, SonarQube, Artifactory, ArgoCD, GitHub). |
| `upload_download.js` | Synthetic Canary Artifact Upload / Download / Delete step. |

### `tests/`

| File | What it does |
|---|---|
| `alert_env_tagging.test.js` | Test: every alert is tagged with its environment and stays in it. |
| `auth_lockdown.test.js` | Test: sign-in and role lock-down (anonymous writes refused, roles enforced). |
| `bfsi_domain_routes.test.js` | Test: normal routes refuse the demo environment; sample data only under /api/demo. |
| `clickhouse_client.test.js` | Test: ClickHouse client (inert without CLICKHOUSE_URL, query and insert behaviour). |
| `collector_auth.test.js` | Automated verification of Collector Authentication & AUTH_FAILED Isolation. |
| `collector_truthfulness.test.js` | Test: collectors never invent values (no Math.random, null when unmeasured). |
| `console_live.test.js` | Live observability console: real data only, honest empties, no sample values. |
| `correlation_replay.test.js` | Test: replays a shared-storage failure and checks the correlation engine finds the dependent applications. |
| `cyberark_fetch_script.test.js` | Real CCP call when configured, no fake secret in production. |
| `cyberark_provider.test.js` | Test: CyberArk credential provider (registry lookup, cache, environment-variable fallback). |
| `dashboard_uplift_endpoints.test.js` | Test: dashboard endpoints return their expected shapes. |
| `dashboards.test.js` | M7 Task 7.2 Test Suite: Dashboard builder schema validation, persistence with fallback, file-based sync, and round-trip export/import. |
| `data_availability_segregation.test.js` | Test: prod and staging data are kept apart; missing data is reported as unavailable. |
| `datastore_migration.test.js` | Test: PostgreSQL metric store queries and migrations. |
| `demo_console.test.js` | Observability-console demo fixtures: consistency between screens, coverage of all monitored applications, and the read-only /api/demo/console/:screen route. |
| `demo_injection.test.js` | The demo injection simulator: safe by default, deterministic, and its traffic fills the real views. |
| `dynatrace_endpoint_env.test.js` | The Dynatrace API address can be set per environment with PROD_/STG_DYNATRACE_API_ENDPOINT. |
| `e2e_ingest_both_envs.test.js` | E2E: dummy data sent to PRD and STG through the real ingest endpoints. |
| `e2e_qa_suite.test.js` | QA AUTOMATED TEST SUITE: INTELLIGENT OBSERVABILITY & AUTONOMOUS RECOVERY Comprehensive End-to-End (E2E) & Systems Assurance Test Suite Tests REST Endpoints, WebSocket Telemetry, Four-Eyes… |
| `e2e_real_data_populates.test.js` | E2E: real data arriving through the ingest endpoints populates the views. |
| `e2e_replay_degradation.test.js` | "Done when" replay: a staging degradation of one fake product, end to end through the real jobs. |
| `entity_hierarchy.test.js` | Test: inventory entity hierarchy and topology built from the manifests. |
| `env_strict_value_not_available.test.js` | Test: values with no source are reported as not available, never filled in. |
| `environment_isolation.test.js` | Automated verification of Per-User Environment Isolation. |
| `inventory_debounce.test.js` | Test: inventory cache writes are debounced (1,000 updates cause at most 2 file writes). |
| `inventory_discovery.test.js` | Test: hosts and services are discovered from OTLP data. |
| `ldap_client.test.js` | Test: LDAP sign-in and mapping of directory groups to roles. |
| `llm_assistant.test.js` | M7 Task 7.3 Test Suite: Internal LLM assistant client, redaction pipeline, fake OpenAI-compatible mock server, and inert state when unconfigured. |
| `load_ingest.test.js` | Test: ingest throughput and storage under load. |
| `load_test_200.js` | Test: scale test with 200 simulated hosts. |
| `log_pipeline.test.js` | Automated verification of Log Pipeline and Log Explorer. |
| `m1_foundation.test.js` | M1 foundation: read auth policy, environment entitlements, ingest API keys, custom metrics line protocol, source arbitration, leader lock (standalone). |
| `m5_detection_alerting.test.js` | Comprehensive Milestone M5 Unit & Integration Tests: 1. Hour-of-week baselines (Median & MAD, robust z-score, weekly cyclicity vs true shift) 2. CUSUM Change-point detection (+30%… |
| `misc_operations.test.js` | Test: on-call rota operations. |
| `otlp_normalizer.test.js` | Test: OTLP metric normalisation (names, units, component and host mapping). |
| `phase_a_agent.test.js` | Phase A acceptance (agent end to end), through the production code paths: - A1 one auth convention: the probe pushes to the real /v1/metrics route in enforce mode with X-Sentinel-Api-Key ->… |
| `phase_a_db_security.test.js` | Phase A acceptance for: - A7 GET /api/v2/databases/overview shapes PostgreSQL / Oracle / SQL Server OpenTelemetry receiver metrics (fake ClickHouse rows) per database, with null for missing… |
| `phase_d_demo_switch.test.js` | Test: demo view and the PRD/STG switch. |
| `phase_f_fixes.test.js` | Comprehensive integration tests for Phase F: Validation Report Fixes (F1 - F8). |
| `phase_g_rootcause.test.js` | Root-cause gap fixes: 1. k8s collector authenticates (Bearer service-account token) and reports AUTH_FAILED on 401/403 2. Inventory links PVC -> PV -> NFS share / Trident volume, and pod ->… |
| `phase_g_wiring.test.js` | Previously dormant features are now registered with the scheduler and degrade honestly. |
| `phase_h_expiry_probes.test.js` | P1.4: expiry_sync reads lifecycle.certificates probes declared in manifests. |
| `phase_h_jenkins_poller.test.js` | P3b: per-controller Jenkins polling. |
| `phase_h_s3_upload.test.js` | P1.5: log archiver uploads to S3 (SigV4, no SDK) and only trusts a confirmed upload. |
| `phase_o_component_api.test.js` | Phase O1 / O1.2 Component Metrics API Acceptance: Tests GET /api/v2/components/:kind/:id/metrics with fake ClickHouse: - Data present: returns populated series. |
| `phase_o_config_catalogue.test.js` | Phase O1 / O1.1 Acceptance: Validates config/component_metrics.yaml and config:check behaviour: - Shipped catalogue passes with exit 0 (14 kinds, all charts valid). |
| `phase_o_forecast.test.js` | Phase O1 / O1.3 Forecast Helper Unit Tests: Tests analytics/forecast.js linearRunway with fixed series and literal expected days. |
| `phase_o0_no_fabrication.test.js` | Acceptance tests for Phase O0: - O0.1: K8s mesh returns real ClickHouse numbers or null per field with DATA_UNAVAILABLE (no zeroes). |
| `phase_o10_sre_extras.test.js` | Phase O10 Acceptance Tests: - O10.1: SLO burn-rate alerts (fast 14.4x & slow 6x) on golden journeys - O10.3: Alert hygiene: flapping detection (>= 4 transitions in 30m) - O10.4: runbook_url… |
| `phase_o2_agent_config.test.js` | Acceptance tests for Phase O2: - O2.1: Linux hostmetrics scrapers (paging, processes, load, tcp) - O2.2: Windows perf counters (Processor Queue Length, Pages/sec, PhysicalDisk, LogicalDisk,… |
| `phase_o2_cardinality.test.js` | Acceptance test for Phase O2: - O2.9: Process cardinality guard: keep full-resolution process metrics only for the top 10 per host and manifest-named processes; aggregate the rest into 'other'. |
| `phase_o2_osquery.test.js` | Acceptance test for Phase O2 osquery packs generator: - O2.3: osquery packs contain the required queries: processes, services, certificates, deb_packages, rpm_packages, programs,… |
| `phase_o2_probe.test.js` | Acceptance tests for Phase O2 probe functionality: - O2.1: NTP offset parsing (system.ntp.offset_ms) - O2.1: File-handle parsing (/proc/sys/fs/file-nr -> used, max) - O2.1: TCP connection… |
| `phase_o3_infra_routes.test.js` | Phase O3 / O3.1 Infrastructure Hosts API Acceptance: Tests GET /api/v2/infra/hosts?os=linux/windows: - Data present: returns 200 OK with shaped host records, metrics, product mappings, agent state. |
| `phase_o4_database_routes.test.js` | Phase O4 / O4.3 Database Endpoints Acceptance: Tests GET /api/v2/databases/overview and GET /api/v2/databases/:id across PostgreSQL, Oracle, and SQL Server with O2.5 sqlquery metrics: -… |
| `phase_o4_k8s_routes.test.js` | Test: Kubernetes API levels (clusters, cluster, node, pod). |
| `phase_o5_app_map_routes.test.js` | Phase O5 / O5.1 Acceptance Tests: Tests GET /api/v2/apps/:id/map?from&to: - Ordered layers: Users → DNS → AVI VIP → SSO → app servers → storage → DB → dependencies - Each node: kind, id,… |
| `phase_o5_pool_member_check.test.js` | Phase O5 / O5.3 Acceptance Test: Per-member VIP check: for each pool member host, compare its localhost timing; flag "one member degraded" when one member's p95 exceeds 2× the median of the others. |
| `phase_o6_restored_screens.test.js` | Acceptance test suite for Phase O6 (Restored Screens): - O6.1: Health checks execution against a local HTTP server fixture + /api/v2/health-checks API - O6.2: Platform health aggregation… |
| `phase_o7_expiry_url.test.js` | Phase O7 Acceptance Tests: - O7.1: Certificate inventory job merges certs, de-duplicates by fingerprint across 3 hosts into 1 item with 3 locations, and flags SHA-1 / TLS 1.0. - O7.2:… |
| `phase_o8_processes_capacity.test.js` | Phase O8 Acceptance Tests: - O8.1: Top processes per host (GET /api/v2/infra/hosts/:host/processes) - O8.2 & O8.6: Alert rules (runaway CPU, FD saturation, trend, disk runway) - O8.3: Stale… |
| `phase_o9_product_jvm.test.js` | Phase O9 Acceptance Tests: - O9.1: Per-product synthetic checks: - Jenkins (queue length, wait time, executors, offline agents, stuck builds > 3x median) - TeamCity (queue length,… |
| `phase_p_jobs.test.js` | Phase P acceptance: every background job is exercised through its job entry point (not through the helper it calls), against local fakes: - P1 VIP probes → a local HTTPS "VIP" →… |
| `phase_q_config_check.test.js` | Q5: `npm run config:check` validates config/alerts/*.yaml and manifest `watch:` paths. |
| `phase_q_git_push_reset.test.js` | Phase Q / Q1 acceptance: git step `action: push_reset` against a local bare repo (file:// URL). |
| `phase_q_jenkins_step.test.js` | Phase Q / Q2 acceptance: Jenkins canary step against a fake Jenkins API (node http). |
| `phase_q_vip_discovery.test.js` | Test: VIP probe DNS answers and certificate names become topology entities and edges. |
| `phase_s_git_llm.test.js` | Phase S acceptance: - S9 git synthetic step runs git asynchronously (event loop stays responsive while a fake git sleeps 2 s), the credential never appears in argv nor in returned error text. |
| `phase_s_security.test.js` | Phase S acceptance (S1-S8): change-window roles and audit, environment from the session and entitlements, dashboard ownership and environment scoping, cookie sessions on alert actions,… |
| `phase_u_dashboard_files.test.js` | Dashboards round-trip through config/dashboards/<slug>.json. |
| `phase_u_fleet.test.js` | Test: fleet view API (version spread, last seen, coverage, silent and drifted agents). |
| `phase_u_product.test.js` | Phase U acceptance for U1: the Product page reads ClickHouse, so every node answers the same. |
| `phase_u_storage.test.js` | Phase U / U5 acceptance for GET /overview of backend/routes/storageRoutes.js: - No ClickHouse -> DATA_UNAVAILABLE with empty shares (no query sent). |
| `phase1_operational_safety.test.js` | Test: operational safety regression suite (phase 1). |
| `phase2_intelligence_observability.test.js` | Test: analysis and observability regression suite (phase 2). |
| `phase3_platform_maturity.test.js` | Test: platform maturity regression suite (phase 3). |
| `prod_data_availability.test.js` | Test: production views say data is not available when nothing was received. |
| `prod_login_lockdown.test.js` | A production process must never accept simulated logins unless explicitly told to, whatever config/global.yaml says the default environment is. |
| `recovery_four_eyes.test.js` | Test: remediation needs two approvers; bypass attempts are refused. |
| `schema_validation.test.js` | Test: YAML manifests and the CyberArk registry pass schema validation. |
| `sentinel_agent.test.js` | Comprehensive Milestone M4 Unit & Integration Tests: 1. sentinel-probe timing, NAS operations, and OTLP payload formatting 2. Dynamic agent config endpoint, scope enforcement, and per-host… |
| `sentinelql.test.js` | M7 Task 7.1 Test Suite: SentinelQL lexer, parser, ClickHouse compiler, injection rejection, time/row limits, and environment parameter injection. |
| `shipper_rollout.test.js` | Automated verification of Log Shipper Rollout. |
| `source_hardening.test.js` | Test: collector hardening (Dynatrace token retry, circuit breaker, fallbacks). |
| `synthetics_runner.test.js` | Tests Golden Journey synthetic runner execution, cascading step skip on failure, leader lock gating, span and metric recording, and zero Math.random() jitter. |
| `telemetry_selector.test.js` | Test: telemetry profile selection. |
| `test_live_otlp.js` | Manual test: sends one OTLP payload to a running Sentinel and prints the result. |
| `topology_layers.test.js` | M3 Task 3.2 Acceptance Tests: 1. syncYamlTopology builds VIP -> Product -> Hosts -> Shares -> Databases graph. |
| `ui_smoke.test.js` | Phase D UI Smoke Test Suite: - 2-way environment switcher: strictly PROD and STAG (zero DEMO in switcher). |
| `version_capture.test.js` | Tests product version capture, inventory label updating, version_change event emission, and debouncing on identical versions. |
| `vip_probe.test.js` | M3 Task 3.1 Acceptance Tests: 1. Probes a local HTTPS server with a self-signed certificate. |

### `tests/fixtures/`

Test data.

| File | What it does |
|---|---|
| `rule_a_network_avi.json` | Test fixture data. |
| `rule_b_avi_path.json` | Test fixture data. |
| `rule_c_storage.json` | Test fixture data. |
| `rule_d_product.json` | Test fixture data. |
| `rule_e_change.json` | Test fixture data. |

### `tests/helpers/`

Helpers shared by tests.

| File | What it does |
|---|---|
| `fake_change_window_pool.js` | In-memory stand-in for the pg pool used by backend/routes/changeRoutes.js. |
| `fake_clickhouse.js` | Minimal ClickHouse HTTP stand-in: records every request and answers through a responder(sql, entry) that returns JSONEachRow rows (array) or { status, text }. |
| `tls.js` | Self-signed certificate for local HTTPS test servers. |

### `tools/validation/`

| File | What it does |
|---|---|
| `capture_screenshots.js` | Validation tool: opens each view in Chrome and saves screenshots. |
| `docker-compose.validation.yml` | Local stack: TimescaleDB and fake upstream tools for validation. |
| `init-db.sql` | Creates the validation database schema. |

### `tools/validation/fixture-otlp-agent/`

| File | What it does |
|---|---|
| `agent.js` | Validation tool: sends a sample OTLP metric payload to Sentinel. |

### `tools/validation/fixture-upstream/`

| File | What it does |
|---|---|
| `server.js` | Validation tool: fake upstream tools (Artifactory, TeamCity, ...) with switchable failure modes. |
