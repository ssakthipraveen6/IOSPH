# 📖 Codebase Architecture Reference & Maintenance Guide

This document is the **master structural reference** for the **Intelligent Observability and Autonomous Recovery Framework** (`windows-yaml-deploy`). It details every folder's purpose, key files, and how to use or extend each component.

---

## 📁 Repository Structure

```
windows-yaml-deploy/
├── config/                      # ⭐ Single source of truth — all YAML configs
│   ├── global_config.yaml       # Environment, prod/staging URLs, AVI, SSO config
│   ├── applications/            # Per-application topology YAMLs (one per app)
│   ├── infrastructure/          # Per-infra-layer YAMLs (avi.yaml, windows.yaml, ...)
│   ├── cyberark/                # CyberArk Safe/Object credential registry
│   ├── telemetry_profiles.yaml  # OTel / Dynatrace / Prometheus profile selector
│   ├── config.js                # YAML parser → runtime config object
│   ├── yaml_config.js           # YAML file loader for all directories
│   └── bitbucket_pr_service.js  # GitOps PR creator for config changes
├── backend/
│   ├── server.js                # Express REST API + WebSocket + OTLP ingest server
│   ├── logger.js                # Rotating log writer (500KB cap, NAS fallback)
│   └── auth/
│       └── ldap_client.js       # eLDAP / Active Directory SSO bind client
├── metrics_collection/
│   ├── collector_coordinator.js # Master concurrent collection loop (prod + staging)
│   ├── telemetry_provider_selector.js  # Resolves active telemetry profile
│   ├── real/
│   │   ├── applications/        # Live HTTP REST collectors (per app)
│   │   ├── infrastructure/      # Live infra collectors (AVI, NAS, SSO, K8s, ...)
│   │   ├── opentelemetry/       # OTLP metric normalizer (OTel → Sentinel keys)
│   │   └── dynatrace/           # Dynatrace API v2 metric sync
│   └── simulation/              # Demo-mode data generators (used in DEMO env)
├── logs_collection/
│   ├── real/fluentd/            # Real log file reader (reads from nas_mount paths)
│   └── simulation/fluentd/      # Demo-mode log stream generator
├── ai_analysis/
│   ├── real_analyzer.js         # Production AI: regex anomaly detection engine
│   ├── rca_analytics_engine.js  # Root cause analysis correlation
│   └── predictive.js            # Metric trend → outage risk score calculator
├── remediation/
│   ├── recovery.js              # Self-healing orchestrator + Jenkins job triggers
│   └── custom_checks.js         # Custom probe registry (external endpoint checks)
├── database/
│   ├── db.js                    # In-memory JSON DB (rolling 200-item cap)
│   ├── postgres.js              # TimescaleDB / PostgreSQL query adapter
│   ├── snowflake.js             # Snowflake log warehouse query adapter
│   └── sqlite_metrics.js        # Rolling metrics_history.jsonl (100-row cap)
├── frontend/
│   └── src/
│       ├── App.jsx              # Root app, WebSocket client, environment selector
│       ├── maintenanceConfig.js # Per-tile maintenance badge toggles
│       └── components/          # UI view components (see below)
├── tests/                       # 11 automated QA test suites
├── nas_logs/                    # Local log fallback (used when NAS mount is unavailable)
├── web.config                   # Windows Server IIS deployment (HttpPlatformHandler)
├── install_service.ps1          # Windows Task Scheduler service registration
└── start.bat                    # One-click Windows startup script
```

---

## 📑 Module-by-Module Reference

---

### 1. ⭐ [`config/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config) — Single Source of Truth

**Purpose**: All environment settings, vendor endpoints, credential mappings, and telemetry profiles are declared here as YAML. No endpoint is hardcoded elsewhere in the codebase.

**Key Files**:

| File | Purpose |
| :--- | :--- |
| [`global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml) | `environment`, `prod_urls`, `stg_urls`, `sso_ldap_config` — the **one file to update for production** |
| [`applications/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/applications) | Per-app topology: endpoints, server hostnames, layers, Jenkins job |
| [`infrastructure/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/infrastructure) | Per-infra-layer config: `avi.yaml`, `windows.yaml`, `unix.yaml`, `sso_eldap.yaml`, `k8s.yaml` |
| [`cyberark/registry.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/cyberark) | Maps credential purposes (`db`, `api_token`) to CyberArk Safe + Object names |
| [`telemetry_profiles.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/telemetry_profiles.yaml) | Selects active telemetry profile: `1` = OTel, `2` = Dynatrace, `3` = Node Exporter |

**How to use**:
- **Update prod endpoints**: Edit `prod_urls` in `global_config.yaml`.
- **Onboard new app**: Create `config/applications/<app_id>.yaml`. Backend auto-discovers it.
- **Switch telemetry provider**: Set `selected_profile: 2` in `telemetry_profiles.yaml` for Dynatrace.

---

### 2. 🖥️ [`backend/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js) — API & WebSocket Server

**Purpose**: Provides all REST API endpoints, the WebSocket real-time telemetry stream, OTLP ingestion, static SPA serving, rate limiting, and authentication middleware.

**Key Endpoints**:

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/healthz` | GET | AVI / RefWeb health monitor probe (`200 UP`) |
| `/api/health` | GET | Real-time environment health score and component statuses |
| `/api/metrics` | GET | Historical time-series metrics from PostgreSQL |
| `/api/alerts` | GET | Active alerts for the current environment |
| `/api/environment` | GET / POST | Read or switch active environment (prod/staging/demo) |
| `/v1/metrics` | POST | OTLP/HTTP metric ingestion from OTel Collector agents |
| `/api/yaml/*` | GET / POST | GitOps YAML config read / write |
| `/api/auth/sso/login` | POST | eLDAP / Active Directory login |
| `/ws` | WebSocket | Real-time telemetry stream with 30s ping/pong heartbeat |
| `*` | GET | SPA wildcard fallback (serves `frontend/dist/index.html`) |

**Key Behaviors**:
- Bound to `0.0.0.0` so AVI / IIS reverse proxies can connect on all network adapters.
- `trust proxy: true` resolves real client IPs from `X-Forwarded-For` headers.
- HTTP gzip/deflate compression via `compression()` middleware.
- Rate limits: 2,000 req/min (general API), 1,000 req/min (OTLP ingest), 50/15min (auth).
- 30-second WebSocket heartbeat prevents corporate firewall / AVI session drops.

---

### 3. 📊 [`metrics_collection/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection) — Telemetry Collectors

**Purpose**: Periodic background polling (every 10 seconds) collecting metrics from all application and infrastructure layers. Runs **concurrently for both `prod` and `staging` environments** so switching the UI view never stops data collection.

**Key Files**:

| File | Purpose |
| :--- | :--- |
| [`collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/collector_coordinator.js) | Master loop. Concurrently dispatches collection for `['staging', 'prod']`. |
| [`telemetry_provider_selector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/telemetry_provider_selector.js) | Reads `telemetry_profiles.yaml` to activate correct collector set. |
| [`real/opentelemetry/otlp_metric_normalizer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/opentelemetry/otlp_metric_normalizer.js) | Maps OTel semantic metric names → Sentinel dashboard keys. |
| `real/applications/` | HTTP REST collectors for each app (Bitbucket, Jenkins, ArgoCD, etc.) |
| `real/infrastructure/` | Infrastructure collectors (AVI, NAS, SSO, Windows, Linux, K8s) |
| `simulation/` | Demo-mode data generators (only active in `DEMO` environment) |

**Telemetry Profiles** (set in `config/telemetry_profiles.yaml`):

| Profile | `selected_profile` | Description |
| :--- | :--- | :--- |
| OpenTelemetry (default) | `1` | OTel Collector agents push OTLP/HTTP to `/v1/metrics` |
| Dynatrace | `2` | Pull from Dynatrace API v2 (`/api/v2/metrics`, `/api/v2/problems`) |
| Prometheus Node Exporter | `3` | Scrape node_exporter (port 9100) and windows_exporter (port 9182) |

---

### 4. 🪵 [`logs_collection/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection) — Log Stream Collectors

**Purpose**: Reads real log files from NAS mount paths (`fluentd_log_path` in `global_config.yaml`) or generates structured demo log streams, feeding them to the AI analysis engine.

**Key Files**:
- [`real/fluentd/fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection/real/fluentd/fluentd_log_collector.js): Reads real log files from disk for the given environment.
- `simulation/fluentd/fluentd_log_collector.js`: Demo-mode structured log generator (used in DEMO env only).

---

### 5. 🧠 [`ai_analysis/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis) — AI Anomaly & Risk Engine

**Purpose**: Inspects log streams using regex pattern matching to detect failure signatures (OOM, DB pool exhaustion, disk saturation) and generates critical alerts tagged with the active environment. Calculates predictive outage risk scores from metric trends.

**Key Files**:

| File | Purpose |
| :--- | :--- |
| [`real_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/real_analyzer.js) | Production anomaly classifier. Generates `env`-tagged alerts and triggers self-healing. |
| [`rca_analytics_engine.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/rca_analytics_engine.js) | Root cause analysis correlation (cross-component timeline analysis). |
| [`predictive.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/predictive.js) | Metric trend → outage risk score algorithm. |

**How to extend**: Add new regex patterns to `ANOMALY_PATTERNS` in `real_analyzer.js`.

---

### 6. ⚡ [`remediation/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation) — Autonomous Self-Healing

**Purpose**: Executes automated recovery runbooks (Jenkins job triggers, container restarts, log purges) in either **Autonomous Mode** or **Manual Four-Eyes Dual Approval** governance mode.

**Key Files**:

| File | Purpose |
| :--- | :--- |
| [`recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/recovery.js) | Workflow orchestrator. Maps components → Jenkins jobs. Tags recovery runs with `env`. |
| [`custom_checks.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/custom_checks.js) | Custom probe registry (`CUSTOM_CHECKS_REGISTRY`) for external endpoint validations. |

**How to extend**:
- Add recovery workflow to `workflows` in `recovery.js`.
- Add custom probe to `CUSTOM_CHECKS_REGISTRY` in `custom_checks.js`.

---

### 7. 🗄️ [`database/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database) — Data Persistence Layer

**Purpose**: Multi-tier storage stack with environment isolation across all layers.

| File | Purpose |
| :--- | :--- |
| [`db.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/db.js) | In-memory JSON DB with `sentinel_db.json` persistence. Rolling 200-item cap per environment. |
| [`sqlite_metrics.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/sqlite_metrics.js) | `metrics_history.jsonl` rolling 100-row archive cap. |
| [`postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/postgres.js) | TimescaleDB / PostgreSQL query adapter. Reads `db_jdbc` from config. |
| [`snowflake.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/snowflake.js) | Snowflake log warehouse query adapter. |

**Environment isolation**: All `db.addMetric()`, `db.getAlerts()`, `db.getMetrics()` calls are environment-scoped. Prod data is never mixed with staging data.

---

### 8. 🎨 [`frontend/src/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src) — React 19 Dashboard

**Purpose**: Web UI with real-time WebSocket streaming, environment selector, multi-timezone clocks (SG/IST/EST/GMT), dark/light theme, GitOps YAML manager, SSO admin panel, and maintenance mode system.

**Key Components**:

| Component | Purpose |
| :--- | :--- |
| [`App.jsx`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/App.jsx) | Root app, sidebar navigation, WebSocket client (`wss://<host>/ws`), environment selector |
| `HealthOverview.jsx` | Real-time health score, component status grid, active alerts |
| `MetricsDetail.jsx` | Historical sparkline charts (PostgreSQL data) |
| `UnifiedHealthMatrix.jsx` | Full application + infrastructure health matrix |
| `CommandCenter.jsx` | Self-healing controls, chaos engineering toggles, approval queue |
| `PowerBiDashboard.jsx` | Log analytics and trend charts (Snowflake data) |
| `AiLogPerformance.jsx` | AI anomaly log terminal and risk score display |
| `RcaDashboard.jsx` | Root cause analysis correlation timeline |
| `YamlConfigManager.jsx` | In-browser YAML editor with schema validation and Bitbucket PR creation |
| `AdminManagement.jsx` | RBAC user management, four-eyes approval governance |
| `MiscOperations.jsx` | Custom checks runner, maintenance mode management |
| [`maintenanceConfig.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/maintenanceConfig.js) | Per-tile maintenance badge toggle file |

**All API calls use relative paths** (`/api/*`) — the frontend works with any hostname or AVI Virtual Service URL automatically.

---

### 9. 🧪 [`tests/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/tests) — Automated QA Suite

Run `npm test` to execute all 11 automated test suites in sequence:

| Test File | Coverage Area |
| :--- | :--- |
| `cyberark_provider.test.js` | CyberArk Safe/Object credential vault resolution |
| `auth_lockdown.test.js` | JWT token validation and role enforcement |
| `schema_validation.test.js` | YAML schema integrity checks |
| `telemetry_selector.test.js` | OTel / Dynatrace / Prometheus profile selection |
| `otlp_normalizer.test.js` | OTel metric name → Sentinel key normalization |
| `datastore_migration.test.js` | Rolling cap enforcement on JSON DB and JSONL archive |
| `misc_operations.test.js` | Custom checks registry and probe assertions |
| `prod_data_availability.test.js` | Prod/Staging/Demo data isolation |
| `data_availability_segregation.test.js` | Concurrent dual-environment background collection |
| `load_test_200.js` | 200-host fan-out concurrency sweep (50-concurrent ceiling) |
| `e2e_qa_suite.test.js` | Full DB, REST API, recovery runbook, and chaos engineering checks |

---

### 10. 🏭 [`web.config`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/web.config) — Windows Server IIS Deployment

Pre-configured for Windows Server IIS with:
- `HttpPlatformHandler`: Routes all requests to `node.exe backend\server.js`.
- `<webSocket enabled="true" pingInterval="00:00:30" />`: Native IIS WebSocket support.
- `<urlCompression>`: Dynamic and static gzip compression.
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

---

## 🚀 Commands Reference

| Task | Command | Description |
| :--- | :--- | :--- |
| **Launch (Windows)** | `start.bat` | One-click: installs deps, builds frontend, starts server |
| **Launch (manual)** | `npm start` | Starts Express + WebSocket server on `0.0.0.0:3001` |
| **Build Frontend** | `npm run build-frontend` | Compiles Vite React bundle into `frontend/dist/` |
| **Run QA Suite** | `npm test` | Executes all 11 automated test suites |
| **Dev Mode** | `npm run dev` | Backend + Vite HMR dev servers concurrently |
| **Register Service** | `./install_service.ps1` | Registers Windows Task Scheduler daemon |

---

## 🐍 Python Browser Check Integration

For SSO page-load and login validation probes, the collector supports spawning headless Python / Selenium checks:

1. Place your Python script in [`metrics_collection/real/python_checks/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/python_checks/).
2. Install dependencies: `pip install -r metrics_collection/real/python_checks/requirements.txt`.
3. Use the `runner.js` bridge module to spawn and capture JSON output from Python.

The system falls back gracefully to baseline defaults if Python is not available — no crash occurs.
