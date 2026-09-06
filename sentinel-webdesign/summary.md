# 📁 Project Sentinel — Codebase & Directory Structure Summary

This document provides a comprehensive structural summary of every folder across Project Sentinel, detailing the functions it holds, its operational responsibilities, and how it is utilized across the platform.

---

## 🏛️ High-Level Monorepo Overview

The core codebase is organized as an enterprise modular monorepo using npm workspaces (`apps/*`, `packages/*`):

```text
sentinel-webdesign/
├── .github/                     # GitHub Actions CI/CD workflows & automated quality gates
│   └── workflows/ci.yml         # Dual-OS matrix build, linter & test runner (Ubuntu & Windows)
├── .runtime/                    # Local runtime storage & emulated NAS shares (.gitignore protected)
│   ├── nas_logs/                # Local NAS directory holding rotating logs & .log.gz archives
│   ├── sentinel_db.json         # Local write-behind fallback database for metrics & alerts
│   ├── metrics_history.jsonl    # Local append-only metric data buffer
│   ├── team_rota.json           # Active monthly on-call schedule state
│   └── sentinel_users.json      # Offline user session & RBAC fallback accounts
├── apps/                        # Executable application microservices & frontend UI
│   ├── api/                     # Backend Express REST API, WebSockets & OTLP receiver
│   ├── collector/               # Telemetry collection daemon & scheduling orchestrator
│   └── web/                     # React 19 + Vite enterprise NOC dashboard UI
├── packages/                    # Decoupled shared libraries (@sentinel/*)
│   ├── analysis/                # AI anomaly detection, regression, RCA & team rota
│   ├── remediation/             # Autonomous self-healing, custom checks & four-eyes approval
│   ├── config/                  # Declarative YAML configs, schema validators & CyberArk CCP
│   ├── database/                # TimescaleDB/Postgres, Snowflake & local cache adapters
│   ├── logger/                  # Daily rotating audit log stream & NAS log writer
│   └── shared-constants/        # Canonical severity levels, statuses & environment enums
├── deployments/                 # Infrastructure-as-Code (Ansible, K8s, Windows IIS, systemd, OTel)
├── tests/                       # Automated regression, security & integration test suites
├── docs/                        # Architecture diagrams, specifications & technical guides
└── scripts/                     # Linting, validation & helper scripts
```

---

## 📂 Detailed Folder Breakdown

### 1. `.github/` & `.runtime/` — Continuous Integration & Local Runtime Storage

#### 1.1 `.github/` — Continuous Integration & Quality Gates (GitHub Actions)
* **Primary Role:** Automated enterprise CI/CD pipeline triggered automatically on every commit, pull request, and release branch.
* **Architecture & Locations:**
  * Root Repository CI: [`.github/workflows/ci.yml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/.github/workflows/ci.yml) (runs when pushing root repository to GitHub).
  * Monorepo Standalone CI: [`sentinel-webdesign/.github/workflows/ci.yml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/.github/workflows/ci.yml) (runs when pushing `sentinel-webdesign` directly).
  * Bitbucket Equivalent: [`bitbucket-pipelines.yml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/bitbucket-pipelines.yml) (runs automated quality gates when pushed to Bitbucket Cloud/Server).
* **Key Functions & Verification Pipeline:**
  * **Dual-OS Matrix**: Runs parallel verification on `ubuntu-latest` and `windows-latest` to prevent cross-platform pathing or command syntax regressions.
  * **Node.js Alignment**: Synchronizes runtime version with `.nvmrc` (`v24.x` / `v20.x`) with automated npm package caching.
  * **Constants Linter**: Executes `npm run lint:constants` (`scripts/lint_severity_constants.js`) to guarantee strict conformance to `@sentinel/shared-constants` (preventing un-sanitized strings like `"critical"` or `"warn"`).
  * **Automated Test Suite**: Executes `npm test` across all 11 enterprise test suites (authentication lockdown, CORS validation, CyberArk resolution, TimescaleDB batching, OTLP normalization, telemetry provider selection, and autonomous recovery).
  * **Frontend Compilation**: Builds the production React 19 single-page application (`npm run build`) to catch bundling, JSX, or CSS errors before deployment.
  * **Security Vulnerability Audit**: Scans dependencies for high/critical security advisories via `npm audit`.
* **Usage & Enforcement:** Acts as an immutable quality gate protecting `main`, `master`, and `release/*` branches. Any failing test or syntax error blocks the merge.

---

#### 1.2 `.runtime/` — Local Persistence, Write-Behind Cache & Emulated NAS Shares
* **Primary Role:** High-availability local runtime storage directory dynamically created by backend services and collectors. Serves as a zero-data-loss fallback layer and emulates production network-attached storage during local or offline execution.
* **Security & Git-Ignore Protection:** Strictly listed in `.gitignore`. Transient telemetry, active session tokens, and local log dumps are never committed to version control.
* **Key Files, Folders & Operational Responsibilities:**
  * `nas_logs/`: Emulates the production enterprise UNC share (`d:\production_shares\nas_logs` or `\\corp.internal\shares\sentinel_logs`). Holds the live application log stream (`windows_yaml_observability.log`) and automated daily gzip archives (`*.log.gz` / `*.log.txt`).
  * `sentinel_db.json`: High-availability local write-behind cache storing real-time component statuses, active alert queues, chaos injection states, and autonomous recovery run histories when remote PostgreSQL / TimescaleDB is unreachable.
  * `metrics_history.jsonl`: Append-only newline-delimited JSON buffer capturing streaming metric data points before batch insertion into TimescaleDB.
  * `team_rota.json`: Local working copy and state persistence for the 24/7 monthly SRE on-call rotation schedules across Core, BAU, and Montreal squads.
  * `sentinel_users.json`: Offline user authentication store and hashed credentials used during air-gapped testing and development when enterprise eLDAP/Active Directory is unreachable.
* **Usage & Failover Flow:**
  1. If PostgreSQL connection drops (`ENOTFOUND` / timeout), the datastore adapter automatically writes to `.runtime/sentinel_db.json`.
  2. If the production NAS share is unmounted or permission-denied, the logger automatically writes to `.runtime/nas_logs/`.
  3. When services restart, `.runtime/` state is loaded into memory to ensure seamless continuity.

---

### 2. `apps/` — Application Daemons & Presentation

#### 2.1 `apps/api/` — Backend Orchestration Service
* **Primary Role:** Central Express.js backend server listening on `0.0.0.0:3001` with WebSocket streaming.
* **Key Functions & Files:**
  * [`src/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/server.js): Master router, WebSocket broadcast server, AVI health check probe (`GET /api/healthz`), and runtime environment switcher (`prod`, `staging`, `demo`).
  * [`src/cors_validator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/cors_validator.js): Strict hostname-based CORS validator parsing `new URL(origin).hostname` against corporate intranet domains (`.internal`, `.corp`, `.refweb.internal.corp`).
  * [`src/auth/ldap_client.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/auth/ldap_client.js): Active Directory / eLDAP user authentication provider.
  * [`src/auth/session.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/auth/session.js): Cryptographic JWT token generation, signature validation, and RBAC authorization middleware.
  * [`src/audit_logger.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/audit_logger.js): Append-only audit logger writing administrative events to `sentinel_audit.log`.
  * [`src/services/health/healthCalculator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/services/health/healthCalculator.js): Aggregates weighted health scores across applications and infrastructure layers.
  * [`src/services/telemetry/uptimeResolver.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/services/telemetry/uptimeResolver.js): Formats system uptime durations into human-readable strings.
* **Usage:** Serves the frontend React app via REST/WebSocket, handles user authentication, ingests OpenTelemetry OTLP pushes, and queries persistent metrics.

---

#### 2.2 `apps/collector/` — Telemetry Collection & Ingestion Engine
* **Primary Role:** Autonomous background daemon executing scheduled health checks, API polling, and metric extraction.
* **Key Functions & Files:**
  * [`src/metrics_collection/collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/collector_coordinator.js): Master scheduler orchestrating tiered collection loops (`high`: 10s, `medium`: 30s, `low`: 60s) and demo mode lifecycle management.
  * [`src/metrics_collection/telemetry_provider_selector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/telemetry_provider_selector.js): Resolves active telemetry profiles (Profile 1: OpenTelemetry OTLP push, Profile 2: Dynatrace API v2, Profile 3: Prometheus Node Exporter) to eliminate duplicate scraper overhead.
  * `src/metrics_collection/real/`: Production collectors making authenticated HTTPS/TCP network probes against live enterprise endpoints (`bitbucket`, `jenkins`, `artifactory`, `avi_load_balancer`, `database`, `docker`, `k8s`, `node_exporter`, `nas`, `s3`, `sso`).
  * `src/metrics_collection/simulation/`: Realistic mock telemetry generators used exclusively during demo / sandbox mode without network access.
  * `src/logs_collection/`: Fluentd log streaming collectors for application logs.
  * `src/ai_analysis/` & `src/remediation/`: Decoupled package shims importing `@sentinel/analysis` and `@sentinel/remediation`.
* **Usage:** Continuously extracts real-time latency, error rates, CPU/RAM, and cgroup metrics, persisting them to the database and triggering alerts when thresholds are breached.

---

#### 2.3 `apps/web/` — Frontend React Dashboard UI
* **Primary Role:** High-performance React 19 + Vite Single-Page Application (SPA) structured into domain-specific pods.
* **Key Pods & Components:**
  * `src/components/health/`:
    * `UnifiedHealthMatrix.jsx`: Enterprise grid showing live status of all DevOps tools and infrastructure layers.
    * `HealthOverview.jsx`: Visual topology pipeline diagram with interactive node drilldowns.
    * `EntityDrillDownPanel.jsx`: Side-drawer displaying granular telemetry, container stats, and log streams for a selected service.
  * `src/components/sre/`:
    * `CommandCenter.jsx`: Chaos injection triggers (outages, latency spikes, memory leaks) and environment toggles.
    * `SelfRunbook.jsx`: Execution interface for automated self-healing runbooks.
    * `SreEnterpriseControl.jsx`: Four-Eyes dual administrator approval queue for critical automated actions.
  * `src/components/analytics/`:
    * `PowerBiDashboard.jsx`: Historical analytics with configurable date ranges and exportable metrics.
    * `MetricsDetail.jsx`: Real-time multi-metric sparkline visualizer.
  * `src/components/correlation/`:
    * `UnifiedCorrelationTimeline.jsx`: Cross-system event stream correlating incidents with deployments and alerts.
    * `DriftRcaCorrelationFeed.jsx`: Root Cause Analysis (RCA) recommendations and ServiceNow ticket sync.
    * `GlobalEntitySearch.jsx`: Full-text searchable directory of enterprise servers, clusters, and VIPs.
  * `src/components/admin/`:
    * `YamlConfigManager.jsx`: In-browser viewer and editor for declarative YAML configuration files.
    * `AdminManagement.jsx`: User management and role-based access control (RBAC).
* **Usage:** Provides SREs, NOC operators, and DevOps engineers with real-time operational visibility and autonomous remediation controls.

---

### 3. `packages/` — Shared Domain Libraries (`@sentinel/*`)

#### 3.1 `packages/analysis/` (`@sentinel/analysis`)
* **Primary Role:** Machine learning, statistical regression, log pattern analysis, and roster scheduling.
* **Key Functions & Files:**
  * `real_analyzer.js` & `simulation_analyzer.js`: Regex anomaly detectors scanning server log streams for critical fault signatures (`OOMKilled`, `Disk Full`, `Connection Pool Saturated`).
  * `predictive.js`: Linear regression engine (`calculateLinearRegression`) projecting metric trajectories (e.g. disk capacity exhaust time).
  * `rca_analytics_engine.js`: Root cause analysis engine cross-referencing telemetry anomalies with active ServiceNow incidents.
  * `team_rota_service.js`: Enterprise multi-rota schedule generator and Excel parser for 24/7 on-call teams (Core, BAU, Montreal).
* **Usage:** Imported by `apps/api` and `apps/collector` to analyze telemetry trends and recommend remediation actions.

---

#### 3.2 `packages/remediation/` (`@sentinel/remediation`)
* **Primary Role:** Autonomous recovery orchestration, custom operational assertions, and multi-signature security governance.
* **Key Functions & Files:**
  * `custom_checks.js`: Registry and evaluation engine for operational health checks (`check_jenkins_billing`, `check_payment_gateway`, `check_private_harbor`).
  * `recovery.js`: Master self-healing orchestrator managing recovery workflows, step progression, and Four-Eyes dual approval state machines.
  * `real/jenkins/jenkins_trigger.js` & `simulation/jenkins/jenkins_trigger.js`: Dispatches authenticated Jenkins webhook jobs (`artifactory-jvm-recycle`, `nas-log-purge`, `db-connection-flush`).
* **Usage:** Executes self-healing workflows automatically when critical alerts occur or queues them for manual dual-administrator sign-off.

---

#### 3.3 `packages/config/` (`@sentinel/config`)
* **Primary Role:** Single source of truth declarative configuration and credential vault integration.
* **Key Functions & Files:**
  * `config.js` & `yaml_config.js`: Parses and validates `global_config.yaml`, `applications/*.yaml`, and `infrastructure/*.yaml`.
  * `definitions/`: Unified YAML definitions combining metrics, logs, and CyberArk credential bindings into unified schemas.
  * `cyberark/credential_provider.js`: Resolves passwords and tokens dynamically from CyberArk Central Credential Provider (CCP) with in-memory TTL caching.
  * `cyberark/registry.yaml`: Maps functional requirements to CyberArk Safes and Account Objects (never stores plain text secrets).
* **Usage:** Central configuration module required by all backend services and collectors.

---

#### 3.4 `packages/database/` (`@sentinel/database`)
* **Primary Role:** Multi-backend persistence abstraction layer for time-series metrics and historical logs.
* **Key Functions & Files:**
  * `postgres.js`: Connection pool manager (`pg.Pool`) and multi-row batch insert engine for PostgreSQL / TimescaleDB.
  * `snowflake.js`: Datastore adapter querying long-term log volume archives.
  * `index.js`: In-memory cache with fallback to local JSON write-behind storage for high availability.
* **Usage:** Stores telemetry streams, alerts, audit logs, and operational metrics across environments.

---

#### 3.5 `packages/logger/` (`@sentinel/logger`)
* **Primary Role:** High-throughput rotating log stream engine.
* **Key Functions & Files:**
  * `logger.js`: Rotating file stream configured with 10MB slice caps, daily rotation, and 30-day retention with gzip compression.
  * `writeNasLog(level, category, message)`: Writes structured audit and collector events to NAS mount storage.
* **Usage:** Provides production-grade logging for compliance, debugging, and NAS log aggregation.

---

#### 3.6 `packages/shared-constants/` (`@sentinel/shared-constants`)
* **Primary Role:** Centralized dictionary of immutable enterprise domain constants.
* **Key Enums:**
  * `SEVERITY`: `CRITICAL`, `WARNING`, `HEALTHY`, `INFO`, `UNKNOWN`.
  * `normalizeSeverity(val)`: Sanitizes mixed-case strings into standard uppercase constants.
* **Usage:** Imported across all backend, collector, and frontend code to prevent magic strings and casing mismatches.

---

### 4. Supporting Monorepo Directories

| Directory | Primary Responsibility | Usage in Project Sentinel |
| :--- | :--- | :--- |
| **`tests/`** | **Automated Regression & Security Suite** | Contains 11 standalone unit and integration test suites run by `npm test` and CI: authentication lockdown, CORS origin validation, CyberArk resolution, TimescaleDB batching, strict environment segregation, OTLP normalization, and e2e QA. |
| **`deployments/`** | **Enterprise Deployment Automation** | Holds platform-specific deployment scripts: Ansible playbooks, Kubernetes manifests/Helm charts, Linux systemd unit files, Windows Server PowerShell scripts (`install_service.ps1`), and OpenTelemetry agent configs. |
| **`docs/`** | **Architecture & Documentation** | Contains Mermaid diagrams, interactive HTML blueprints (`ARCHITECTURE_DIAGRAMS.html`), domain reports, and architectural specifications. |
| **`scripts/`** | **Developer Tooling & Linting** | Contains custom static analysis scripts, including `lint_severity_constants.js` to ensure uniform severity usage. |

---

### 5. Workspace Root Legacy Folders (Parent Directory)

| Directory | Status | Usage / Description |
| :--- | :--- | :--- |
| **`Linux-Deploy/`** | *Legacy / Preserved* | Standalone Linux deployment bundle created prior to monorepo consolidation. |
| **`Windows-Deploy/`** | *Legacy / Preserved* | Standalone Windows deployment bundle created prior to monorepo consolidation. |
| **`windows-yaml-deploy/`** | *Legacy / Preserved* | Standalone YAML-based Windows deployment bundle. |

---

## ⚡ Quick Reference: Where Does Code Live?

| Functional Requirement | Primary Implementation Location |
| :--- | :--- |
| **CI/CD Quality Gate Pipeline** | [`.github/workflows/ci.yml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/.github/workflows/ci.yml) |
| **Local Cache & NAS Storage** | [`.runtime/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/.runtime) |
| **REST API & WebSockets** | [`apps/api/src/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/server.js) |
| **CORS Origin Security** | [`apps/api/src/cors_validator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/cors_validator.js) |
| **Active Directory / LDAP Auth** | [`apps/api/src/auth/ldap_client.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/auth/ldap_client.js) |
| **Telemetry Collection Scheduler**| [`apps/collector/src/metrics_collection/collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/collector_coordinator.js) |
| **Production Telemetry Profiles**| [`apps/collector/src/metrics_collection/telemetry_provider_selector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/telemetry_provider_selector.js) |
| **Frontend Health Matrix** | [`apps/web/src/components/health/UnifiedHealthMatrix.jsx`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/web/src/components/health/UnifiedHealthMatrix.jsx) |
| **AI Log Anomaly Detection** | [`packages/analysis/real_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/analysis/real_analyzer.js) |
| **Automated Recovery Workflows** | [`packages/remediation/recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/remediation/recovery.js) |
| **CyberArk Vault Integration** | [`packages/config/cyberark/credential_provider.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/cyberark/credential_provider.js) |
| **PostgreSQL / TimescaleDB DDL** | [`packages/database/postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database/postgres.js) |
| **Enterprise Rotating Logs** | [`packages/logger/logger.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/logger/logger.js) |
