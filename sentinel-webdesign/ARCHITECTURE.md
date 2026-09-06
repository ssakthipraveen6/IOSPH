# 🏛️ Project Sentinel — Master Technical Architecture & Codebase Reference
**Document:** `ARCHITECTURE.md` | **Version:** `2.5.0-Enterprise` | **Classification:** `Tier-1 Production Blueprint` | **Architecture Profile:** `Profile 1 (OTel Push + Sentinel Probers Default)`

---

## 📑 Table of Contents
1. [Executive Blueprint & System Overview](#1-executive-blueprint--system-overview)
2. [7-Tier Enterprise Monorepo Topology](#2-7-tier-enterprise-monorepo-topology)
3. [End-to-End Data & Event Execution Flows](#3-end-to-end-data--event-execution-flows)
   - [Path A: User Traffic & WebSocket Push Flow](#path-a-user-traffic--websocket-push-flow)
   - [Path B: 2,000+ Node OpenTelemetry Ingestion Flow](#path-b-2000-node-opentelemetry-ingestion-flow)
   - [Path C: AI Anomaly Detection & Autonomous Recovery Flow](#path-c-ai-anomaly-detection--autonomous-recovery-flow)
   - [Path D: Dynatrace Dedicated Host/Management API Flow](#path-d-dynatrace-dedicated-hostmanagement-api-flow)
4. [Dual-Environment Segregation & Demo Lifecycle State Machine](#4-dual-environment-segregation--demo-lifecycle-state-machine)
5. [Granular Feature Toggles & Conditional Execution Flow](#5-granular-feature-toggles--conditional-execution-flow)
6. [Monorepo Directory & Module-by-Module Code Reference](#6-monorepo-directory--module-by-module-code-reference)
   - [packages/config/ — Single Source of Truth](#a-packagesconfig--single-source-of-truth)
   - [apps/api/ — REST API & WebSocket Ingestion Server](#b-appsapi--rest-api--websocket-ingestion-server)
   - [apps/collector/ — Telemetry Collectors & Automation Engine](#c-appscollector--telemetry-collectors--automation-engine)
   - [packages/database/ — Multi-Tier Persistence](#d-packagesdatabase--multi-tier-persistence)
   - [packages/logger/ & packages/auth/ — Logging & Security](#e-packageslogger--packagesauth--logging--security)
   - [apps/web/ — React 19 Frontend Client](#f-appsweb--react-19-frontend-client)
7. [Step-by-Step OpenTelemetry Implementation Guide](#7-step-by-step-opentelemetry-implementation-guide)
8. [Headless Python Synthetic Probers](#8-headless-python-synthetic-probers)
9. [Security, Identity & Vault Governance Architecture](#9-security-identity--vault-governance-architecture)
10. [Network Ingress, Routing & Load Balancing (AVI + IIS + Express)](#10-network-ingress-routing--load-balancing-avi--iis--express)
11. [High-Scale Telemetry & Storage SLA Specifications](#11-high-scale-telemetry--storage-sla-specifications)
12. [Verification & Automated QA Matrix (12/12 Passed)](#12-verification--automated-qa-matrix-1212-passed)
13. [CLI Commands Reference](#13-cli-commands-reference)

---

## 1. 🌟 Executive Blueprint & System Overview

![Project Sentinel Executive Blueprint](./docs/images/executive_blueprint.jpg)

### Executive Overview
**Project Sentinel** is an enterprise observability and autonomous recovery platform engineered for high-scale, Tier-1 Windows Server environments behind corporate **AVI Load Balancers** and **RefWeb / IIS Reverse Proxies**.

The framework is architected around **Profile 1 (Default Production Profile)**:
- **Passive Telemetry Push**: Distributed server fleets (2,000+ Linux, Windows, and Kubernetes nodes) stream metrics via OpenTelemetry OTLP/HTTP directly to `POST /v1/metrics`.
- **Active Synthetic Validation**: Headless Python/Selenium probers perform scheduled synthetic browser checks validating SSO login redirects, certificate validity, and page-load latency.
- **Dedicated Dynatrace Integration**: A dedicated, isolated API function (`fetchHostManagementMetrics`) allows selective querying of Dynatrace API v2 for host/management telemetry without coupling the broader platform.
- **Local AI Anomaly Detection**: Real-time regex pattern matching inspects log streams, predicting failure risk and triggering Jenkins self-healing runbooks under Four-Eyes dual-approval governance.
- **Zero Client Secrets**: The React 19 SPA runs with zero bundled credentials, communicating exclusively through relative `/api/*` REST endpoints and `/ws` WebSockets.

---

## 2. 🏗️ 7-Tier Enterprise Monorepo Topology

![Project Sentinel 7-Layer Architecture](./docs/images/7_layer_topology.jpg)

### Monorepo Structural Tier Responsibilities

| Tier | Name | Canonical Monorepo Path | Technology Stack | Core Functionality |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Presentation Tier** | `apps/web/` | React 19 SPA, Vite, Pure CSS, SVG Charts | Dark/Light theme, multi-timezone clocks, zero client secrets, relative `/api` paths. |
| **2** | **Ingress & VIP Tier** | `web.config`, `deployments/windows/` | AVI Load Balancer, Windows IIS ARR | SSL offloading, `/api/healthz` health monitor, `HttpPlatformHandler` process proxy. |
| **3** | **Application Tier** | `apps/api/` | Node.js Express 4 (`0.0.0.0:3001`), `ws` | `trust proxy` header resolution, Gzip compression, rate limiters, 30s WS heartbeat. |
| **4** | **Services & AI Tier** | `apps/collector/` | Async Tier Coordinator, Regex AI Classifier | **Concurrent Dual-Collection (`prod` + `staging`)**; Four-Eyes Dual Approval governance; on-demand demo lifecycle. |
| **5** | **Ingestion & Vault Tier**| `apps/api/src/otlp_metric_normalizer.js`, `packages/config/cyberark/` | OTLP Ingest (`POST /v1/metrics`), CyberArk CCP | Ingests from **2,000+ server agents**; dynamic Safe/Object vault lookups with sub-5ms caching. |
| **6** | **Persistence Tier** | `packages/database/` | PostgreSQL / TimescaleDB, Snowflake, JSON DB | 7-day partitioned hypertables; environment-segregated cache; 200-item rolling disk cap. |
| **7** | **Configuration Tier** | `packages/config/` | `global_config.yaml`, `telemetry_profiles.yaml`, `applications/*.yaml` | **Single Source of Truth**; zero hardcoded IPs; Bitbucket PR GitOps sync; granular feature switches. |

---

## 3. 🔄 End-to-End Data & Event Execution Flows

![Project Sentinel Data and Event Flow](./docs/images/data_flow_diagram.jpg)

---

### Path A: User Traffic & WebSocket Push Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Enterprise User
    participant AVI as AVI Virtual Service
    participant IIS as Windows Server IIS (web.config)
    participant EXP as Express Backend (apps/api: 0.0.0.0:3001)
    participant WS as WebSocket Server (/ws)
    participant UI as React 19 Dashboard (apps/web)

    User->>AVI: HTTPS GET https://sentinel-observability.internal.corp
    Note over AVI: SSL Offload, Inject X-Forwarded-For<br/>Periodic health check: GET /api/healthz (200 UP)
    AVI->>IIS: Reverse Proxy forward to port 3001
    IIS->>EXP: HttpPlatformHandler dispatches request
    EXP->>UI: Serve compiled SPA (apps/web/dist)
    UI->>WS: Establish wss://<HOST>/ws connection
    EXP->>WS: Start 30s Ping/Pong Heartbeat
    WS-->>UI: Push 'init' payload (Health, Alerts, Metrics, Approvals)
    Note over UI: Dashboard renders live tiles, sparklines, and active environment
```

---

### Path B: 2,000+ Node OpenTelemetry Ingestion Flow

```mermaid
sequenceDiagram
    autonumber
    participant Server as 2,000+ Nodes (Linux / Win / K8s)
    participant OTel as Host OTel Collector Agent
    participant Ingest as POST /v1/metrics (apps/api/src/server.js)
    participant Norm as apps/api/src/otlp_metric_normalizer.js
    participant DB as packages/database/db.js (Write-Behind Cache)
    participant PG as packages/database/postgres.js (TimescaleDB)
    participant WS as WebSocket Broadcast
    participant UI as Application Dashboard Tile (apps/web)

    Server->>OTel: Collect hostmetrics (cpu, memory, disk, network)
    Note over OTel: Attaches resource.attributes:<br/>application.id = "jenkins_k8s"<br/>host.name = "jenkins-prod-01"<br/>environment = "prod"
    OTel->>Ingest: POST /v1/metrics (30s batch)
    Note over Ingest: Rate limiter: 1,000 req/min per IP<br/>Accepts gzip / json payloads
    Ingest->>Norm: normalizeOtlpPayload(payload)
    Note over Norm: Resolves entity identity (application.id / service.name)<br/>Normalizes system.cpu.utilization → "cpu"<br/>Normalizes system.memory.utilization → "memory"<br/>Scales decimals (0.0-1.0) to percentage (0-100%)
    Norm-->>Ingest: Normalized metric batch array
    Ingest->>DB: db.addMetric("jenkins_k8s", "cpu", 67.4, "prod")
    Ingest->>PG: INSERT INTO metrics (timestamp, component, metric_name, value, environment)
    Ingest-->>OTel: HTTP 200 { status: "SUCCESS", count: 4 }
    DB->>WS: broadcastStateChange()
    WS->>UI: Live tick → Jenkins Tile CPU updates to 67.4%
```

---

### Path C: AI Anomaly Detection & Autonomous Recovery Flow

```mermaid
sequenceDiagram
    autonumber
    participant Log as Fluentd Log Collector (nas_mount)
    participant AI as apps/collector/src/ai_analysis/real_analyzer.js
    participant DB as packages/database/db.js (Alerts Store)
    participant Gov as Four-Eyes Approval Queue
    participant Rec as apps/collector/src/remediation/recovery.js
    participant Jen as Jenkins CI/CD Webhook
    participant WS as WebSocket Stream
    participant UI as CommandCenter View (apps/web)

    Log->>AI: analyzeServerLogs(rawLogs, env="prod")
    Note over AI: Scans regex patterns:<br/>/OutOfMemoryError|Java heap space/i<br/>/Connection pool exhausted/i<br/>Match found on component: "jenkins_k8s"
    AI->>DB: db.addAlert({component:"jenkins_k8s", severity:"Critical", env:"prod"})
    AI->>Rec: triggerRecovery("jenkins_k8s", reason, "prod")
    
    alt Autonomous Mode = ON
        Rec->>Jen: POST /job/JOB_RESTART_JENKINS_SERVICE/build
        Jen-->>Rec: HTTP 201 Created (Queue Item)
        Rec->>DB: db.addRecoveryLog({status: "auto-triggered", env:"prod"})
    else Four-Eyes Governance Mode = ON
        Rec->>Gov: Create pending approval record
        Gov->>WS: broadcastStateChange()
        WS->>UI: Increment pending approvals badge
        Note over UI: Approver 1 (SRE) signs off<br/>Approver 2 (Lead) signs off
        UI->>Gov: POST /api/recovery/approve
        Gov->>Jen: POST /job/JOB_RESTART_JENKINS_SERVICE/build
    end

    Rec->>WS: broadcastStateChange()
    WS->>UI: Recovery history logged & health score restored to 100%
```

---

### Path D: Dynatrace Dedicated Host/Management API Flow

```mermaid
sequenceDiagram
    autonumber
    participant Coord as apps/collector/src/metrics_collection/collector_coordinator.js
    participant DynaMod as apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector.js
    participant Config as packages/config/global_config.yaml
    participant DynaAPI as Dynatrace API v2 (/api/v2/metrics/query)

    Coord->>Config: Check isCollectorEnabled("dynatrace")
    alt dynatrace.enabled == true
        Coord->>DynaMod: fetchHostManagementMetrics(env)
        DynaMod->>DynaAPI: GET /api/v2/metrics/query?metricSelector=builtin:host.cpu.usage,builtin:host.mem.usage
        DynaAPI-->>DynaMod: Host status, entityCount, cpu & memory time-series
    else dynatrace.enabled == false
        Coord->>DynaMod: fetchHostManagementMetrics(env)
        Note over DynaMod: Returns { status: 'DISABLED', hosts: 0, reason: 'Dynatrace collector disabled' }
    end
```

---

## 4. 🌍 Dual-Environment Segregation & Demo Lifecycle State Machine

Project Sentinel enforces strict environment isolation across storage, collectors, and UI serving:

```mermaid
stateDiagram-v2
    [*] --> Startup: App Boot (npm start / IIS)
    
    state Startup {
        [*] --> LoadConfig: Read packages/config/global_config.yaml
        LoadConfig --> InitProdStg: Start Prod & Staging Background Polling
        InitProdStg --> DemoDormant: Demo Generators = STRICTLY DORMANT
    }

    state "Production / Staging View" as ProdView {
        RealTelemetry: Live OTel Ingest & Active Probers
        NoSimData: Demo Feeds Zeroed Out
        HealthScore: Calculated Exclusively from Real Telemetry
    }

    state "Demo Simulation View" as DemoView {
        DemoStart: On-Demand Demo Generators Activated
        FaultInjection: Configurable Chaos & Synthetic Logs
        DemoCache: db.metrics.demo Populated
    }

    Startup --> ProdView: UI Opens in PROD or STAGING
    ProdView --> DemoView: User Switches Environment to "DEMO"
    Note over DemoView: Demo loop begins ticking only now

    DemoView --> ProdView: User Switches Environment to "PROD" or "STAGING"
    Note over ProdView: stopDemoSimulation() immediately halts timers<br/>Wipes demo metrics, alerts, logs, and health
```

---

## 5. 🎛️ Granular Feature Toggles & Conditional Execution Flow

Every telemetry component, master collector, and application scraper can be toggled in `packages/config/global_config.yaml` without changing application code:

```mermaid
flowchart TD
    START["Collector Execution Cycle"] --> CHECK_APP{"isApplicationEnabled(appKey)?"}
    
    CHECK_APP -- No --> SKIP_APP["Skip Application Scraping\n(Return DATA_UNAVAILABLE)"]
    CHECK_APP -- Yes --> CHECK_COMP{"isComponentEnabled(compKey)?"}
    
    CHECK_COMP -- No --> SKIP_COMP["Skip Component\n(Keep Health Neutral)"]
    CHECK_COMP -- Yes --> PROBE_TYPE{"Telemetry Source"}
    
    PROBE_TYPE -- "OTel Push" --> OTEL_CHECK["Accept passive push at /v1/metrics\n(Profile 1 Default)"]
    PROBE_TYPE -- "Python Synthetic" --> PY_TOGGLE{"isCollectorEnabled('python_metrics')?"}
    PROBE_TYPE -- "Dynatrace Host API" --> DT_TOGGLE{"isCollectorEnabled('dynatrace')?"}
    
    PY_TOGGLE -- Yes --> RUN_PY["Spawn headless Selenium prober\n(runner.js)"]
    PY_TOGGLE -- No --> SKIP_PY["Return status: SKIPPED\n(Graceful Bypass)"]
    
    DT_TOGGLE -- Yes --> RUN_DT["Execute fetchHostManagementMetrics()\n(Query Dynatrace API v2)"]
    DT_TOGGLE -- No --> SKIP_DT["Return status: DISABLED\n(No outbound network call)"]

    style START fill:#0f2744,color:#fff,stroke:#0099ff
    style OTEL_CHECK fill:#132e1b,color:#fff,stroke:#00cc66
    style SKIP_APP fill:#4d1313,color:#fff,stroke:#cc0000
    style SKIP_COMP fill:#4d1313,color:#fff,stroke:#cc0000
    style SKIP_PY fill:#4d3900,color:#fff,stroke:#ffaa00
    style SKIP_DT fill:#4d3900,color:#fff,stroke:#ffaa00
```

### Toggle Helper Functions in `packages/config/config.js`
```javascript
const config = require('@sentinel/config');

// Master collector switches
config.isCollectorEnabled('dynatrace');        // boolean
config.isCollectorEnabled('python_metrics');  // boolean

// Infrastructure component switches
config.isComponentEnabled('k8s');             // boolean
config.isComponentEnabled('avi');             // boolean

// Application topology switches
config.isApplicationEnabled('bitbucket');     // boolean
config.isApplicationEnabled('jenkins_k8s');   // boolean
```

---

## 6. 📁 Monorepo Directory & Module-by-Module Code Reference

```
sentinel-webdesign/
├── apps/
│   ├── api/                                # Express REST backend & WebSocket engine
│   ├── web/                                # React 19 SPA client with Vite build
│   └── collector/                          # Metrics & Logs collectors (ONLY CANONICAL COLLECTOR TREE)
├── packages/
│   ├── config/                             # ⭐ Single Source of Truth (@sentinel/config)
│   ├── database/                           # Persistence layer (@sentinel/database)
│   ├── logger/                             # Enterprise rotating logging (@sentinel/logger)
│   ├── auth/                               # Enterprise SSO client (@sentinel/auth)
│   └── shared-constants/                   # Shared severity enum (@sentinel/shared-constants)
├── deployments/                            # Production deployment automation (Ansible, OTel, Windows)
├── docs/                                   # Architectural diagrams, visual assets & checklists
├── tests/                                  # 12 Automated QA test suites
├── web.config                              # Windows Server IIS deployment (HttpPlatformHandler)
├── install_service.ps1                     # Windows Task Scheduler daemon installer
└── start.bat                               # One-click Windows startup script
```

---

### A. [`packages/config/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config) — Single Source of Truth

**Purpose**: All environment settings, vendor endpoints, credential mappings, telemetry profiles, and feature toggles are declared here. No endpoint or credential is hardcoded in application logic.

| File | Purpose |
| :--- | :--- |
| [`global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/global_config.yaml) | `environment`, `prod_urls`, `stg_urls`, `sso_ldap_config`, master collector toggles (`dynatrace`, `python_metrics`), `components_enabled`, `applications_enabled` — **the primary file to update for production**. |
| [`telemetry_profiles.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/telemetry_profiles.yaml) | Profile selector: `1` = OpenTelemetry OTLP Push (Default), `2` = Dynatrace, `3` = Prometheus Node Exporter. |
| [`applications/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/applications) | 13 App topology files declaring endpoints, server hostnames, layers, and Jenkins jobs. |
| [`infrastructure/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/infrastructure) | 8 Infra layer configs: `avi.yaml`, `windows.yaml`, `unix.yaml`, `sso_eldap.yaml`, `k8s.yaml`, `firewall.yaml`, `nas.yaml`, `database.yaml`. |
| [`cyberark/registry.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/cyberark/registry.yaml) | Maps credential purposes (`db`, `api_token`) to CyberArk Safe + Object names. |
| [`config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/config.js) | Parses YAML into runtime config. Exports toggle helper functions: `isCollectorEnabled(key)`, `isComponentEnabled(key)`, `isApplicationEnabled(key)`. |
| [`yaml_config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/yaml_config.js) | Dynamic YAML loader for applications and infrastructure layers. |
| [`bitbucket_pr_service.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/config/bitbucket_pr_service.js) | GitOps integration creating Bitbucket pull requests for in-browser configuration changes. |

---

### B. [`apps/api/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api) — REST API & WebSocket Ingestion Server

**Purpose**: Provides all HTTP REST endpoints, WebSocket real-time broadcast, OpenTelemetry OTLP ingestion, static SPA serving, rate limiting, and SSO authentication.

- [`src/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/server.js): Main Express daemon listening on `0.0.0.0:3001`.
- [`src/otlp_metric_normalizer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/api/src/otlp_metric_normalizer.js): Maps OTel semantic conventions to Sentinel dashboard keys.

**Key Endpoints**:
- `GET /api/healthz` — AVI / RefWeb health monitor probe (`200 UP`).
- `GET /api/health` — Real-time environment health score and component statuses.
- `GET /api/metrics` — Historical time-series metrics from PostgreSQL / TimescaleDB.
- `GET /api/alerts` — Active alerts for the selected environment.
- `GET / POST /api/environment` — Read or switch active environment (`prod`/`staging`/`demo`).
- `POST /v1/metrics` — OTLP/HTTP metric ingestion from 2,000+ host OTel agents.
- `GET / POST /api/yaml/*` — GitOps YAML config read / write.
- `POST /api/auth/sso/login` — eLDAP / Active Directory login.
- `WebSocket /ws` — Real-time telemetry stream with 30s ping/pong keepalive heartbeat.
- `GET *` — SPA wildcard fallback (serves `apps/web/dist/index.html`).

---

### C. [`apps/collector/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector) — Telemetry Collectors & Automation Engine

**Purpose**: Runs periodic background collection loops concurrently for `prod` and `staging` environments. Hosts the standalone Dynatrace host API function and headless Python Selenium probers.

| Module | Purpose |
| :--- | :--- |
| [`src/metrics_collection/collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/collector_coordinator.js) | Master loop. Concurrently dispatches collection for `['staging', 'prod']`. Manages on-demand demo lifecycle (`startDemoSimulation`, `stopDemoSimulation`). |
| [`src/metrics_collection/telemetry_provider_selector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/telemetry_provider_selector.js) | Resolves active telemetry profile (`1` = OTel, `2` = Dynatrace, `3` = Prometheus). |
| [`src/metrics_collection/real/dynatrace/dynatrace_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector.js) | Contains standard collector AND standalone **`fetchHostManagementMetrics(env)`** for querying host CPU, memory, and infrastructure status. Honors `collectors.dynatrace.enabled` toggle. |
| [`src/metrics_collection/real/python_checks/runner.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/real/python_checks/runner.js) | Spawns headless Python/Selenium prober. Honors `collectors.python_metrics.enabled` toggle. |
| [`src/metrics_collection/real/app_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/real/app_collector.js) | Auto-discovers and runs 32 application collectors, filtering by `isApplicationEnabled()`. |
| [`src/metrics_collection/real/infra_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/metrics_collection/real/infra_collector.js) | Auto-discovers and runs infrastructure scrapers, filtering by `isComponentEnabled()`. |
| [`src/logs_collection/real/fluentd/fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/logs_collection/real/fluentd/fluentd_log_collector.js) | Reads real log files from `nas_mount` paths for the active environment. |
| [`src/ai_analysis/real_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/ai_analysis/real_analyzer.js) | Production regex anomaly detector. Tags alerts with `env` and triggers self-healing. |
| [`src/remediation/recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/collector/src/remediation/recovery.js) | Autonomous recovery orchestrator. Dispatches Jenkins webhook jobs or queues Four-Eyes approvals. |

---

### D. [`packages/database/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database) — Multi-Tier Persistence

| File | Purpose |
| :--- | :--- |
| [`db.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database/db.js) | In-memory write-behind cache with local `.runtime/sentinel_db.json` persistence. Bounded at rolling 200-item cap per environment. |
| [`postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database/postgres.js) | PostgreSQL / TimescaleDB client pool with asynchronous batch write-behind buffer (`flushMetrics`). |
| [`snowflake.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database/snowflake.js) | Snowflake query adapter for cold log analytics and PowerBI trends. |
| [`sqlite_metrics.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/database/sqlite_metrics.js) | Rolling `.runtime/metrics_history.jsonl` (100-row cap). |

---

### E. [`packages/logger/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/logger) & [`packages/auth/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/auth) — Logging & Security

| File | Purpose |
| :--- | :--- |
| [`logger.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/logger/logger.js) | Enterprise rotating file stream (10MB per file, 1-day rotation, 30 max files). |
| [`audit_logger.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/logger/audit_logger.js) | Immutable audit logger writing to `apps/api/logs/sentinel_audit.log`. |
| [`ldap_client.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/packages/auth/ldap_client.js) | Enterprise Active Directory / eLDAP TLS bind, JWT token issuance, and RBAC mapping. |

---

### F. [`apps/web/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/apps/web) — React 19 Frontend Client

**Purpose**: High-performance single page application built with Vite and pure CSS variables.
- Multi-timezone clocks (Singapore, India, New York, UTC).
- Real-time WebSocket streaming with automatic reconnect.
- Live environment switcher (`PROD` | `STAGING` | `DEMO`).
- Interactive views: `HealthOverview`, `MetricsDetail`, `UnifiedHealthMatrix`, `CommandCenter`, `PowerBiDashboard`, `AiLogPerformance`, `RcaDashboard`, `YamlConfigManager`, `AdminManagement`, `MiscOperations`.
- All API requests use relative `/api/*` endpoints — automatically compatible with any reverse proxy or VIP URL.

---

## 7. 🌐 Step-by-Step OpenTelemetry Implementation Guide

### A. Ingestion Endpoint (`POST /v1/metrics`)
OpenTelemetry Collector agents deployed across your 2,000+ server fleet push OTLP/HTTP JSON or protobuf batches to:
`https://<SENTINEL_URL>/v1/metrics`

### B. Normalization Engine (`apps/api/src/otlp_metric_normalizer.js`)
The normalizer performs three critical operations:
1. **Entity Identification**: Resolves `application.id` or `service.name` from `resource.attributes`. Falls back to `host.name`.
2. **Semantic Convention Mapping**:
   - `system.cpu.utilization`, `container.cpu.usage.total` → `cpu`
   - `system.memory.utilization`, `jvm.memory.used` → `memory`
   - `system.filesystem.utilization`, `disk.used_percent` → `disk`
   - `http.server.duration`, `network.latency` → `latency`
3. **Value Scaling**: Floating-point ratios (0.0 to 1.0) are automatically multiplied by 100 to yield 0-100% integers.

### C. Agent Configuration Example (`otel-collector-config.yaml`)
```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      network:

processors:
  batch:
    timeout: 5s
    send_batch_size: 256
  resource:
    attributes:
      - key: application.id
        value: "jenkins_k8s"
        action: upsert
      - key: environment
        value: "prod"
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://sentinel-observability.internal.corp/v1/metrics"
    headers:
      Authorization: "Bearer <sentinel_token>"

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
```

---

## 8. 🐍 Headless Python Synthetic Probers

Headless Selenium browser checks are orchestrated via `apps/collector/src/metrics_collection/real/python_checks/runner.js`.

**Execution Flow**:
1. Checks `config.isCollectorEnabled('python_metrics')`. If `false`, returns `{ status: 'SKIPPED' }` without launching Python.
2. If `true`, spawns `python probe_browser.py --url <TARGET_URL>`.
3. Validates SSO redirect, page load latency (ms), and login form presence.
4. Returns JSON metrics consumed directly by the collector coordinator.

---

## 9. 🛡️ Security, Identity & Vault Governance Architecture

```mermaid
flowchart TD
    subgraph SSO_AUTH["1. Identity & Single Sign-On"]
        LDAP["Active Directory / eLDAP Bind\n(packages/auth/ldap_client.js)\nldaps://ldap.enterprise.corp:636"]
        JWT["Signed JWT Session Token\n(Cookie / Authorization Header)"]
        RBAC["Role-Based Access Control:\n- Super-Admin\n- SRE Lead\n- NOC Operator\n- Security Auditor"]
    end

    subgraph VAULT_SECURITY["2. Credential Vault Integration"]
        CCP["CyberArk Central Credential Provider (CCP)\nGET /AIMWebService/api/Accounts"]
        REG["packages/config/cyberark/registry.yaml\n(Safe: APP_PROD_VAULT, Object: svc_db_account)"]
        CACHE["In-Memory Credential Cache\n(Sub-5ms resolution, 91.5% hit rate)"]
        FALLBACK["Environment Variable Fallback\n(PGUSER, PGPASSWORD, etc.)"]
    end

    subgraph GOVERNANCE["3. Operational Governance"]
        FE["Four-Eyes Dual Approval Queue\n(Requires 2 authorized sign-offs)"]
        AUDIT["Immutable Audit Log\n(packages/logger/audit_logger.js)\napps/api/logs/sentinel_audit.log"]
        HELMET["HTTP Security Hardening\n(CSP, HSTS, X-Frame-Options, CORS Allowlist)"]
    end

    LDAP --> JWT --> RBAC
    REG --> CCP --> CACHE
    CCP -.->|Vault timeout| FALLBACK
    RBAC --> FE --> AUDIT

    style SSO_AUTH fill:#0f2744,color:#fff,stroke:#0099ff
    style VAULT_SECURITY fill:#3b2a00,color:#fff,stroke:#ffaa00
    style GOVERNANCE fill:#2a1a3b,color:#fff,stroke:#bb66ff
```

---

## 10. 🌐 Network Ingress, Routing & Load Balancing (AVI + IIS + Express)

```
[Enterprise Users / Browsers / Intranet]
                   │
         HTTPS (Port 443) / RefWeb URL
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│           AVI LOAD BALANCER VIRTUAL SERVICE             │
│  - Virtual IP: Assigned Corporate VIP                   │
│  - SSL Offloading / Re-encryption                       │
│  - Health Monitor: GET /api/healthz (200 UP every 15s)  │
│  - X-Forwarded-For, X-Forwarded-Proto Header Injection  │
│  - WebSocket Protocol Upgrade Pass-Through              │
└──────────────────────────┬──────────────────────────────┘
                           │
                 HTTP / Reverse Proxy
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              WINDOWS SERVER IIS INSTANCE                │
│  - web.config configuration                             │
│  - HttpPlatformHandler: routes all traffic to node.exe  │
│  - Native IIS WebSocket Support (pingInterval="00:00:30")│
│  - URL Compression (doStatic=true, doDynamic=true)      │
│  - Security Headers (X-Content-Type-Options, Frame-Deny)│
└──────────────────────────┬──────────────────────────────┘
                           │
                 0.0.0.0:3001 (TCP)
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│        NODE.JS EXPRESS 4 DAEMON (apps/api)              │
│  - trust proxy = true                                   │
│  - compression() Gzip middleware                        │
│  - 2,000 req/min API rate limiter                       │
│  - 1,000 req/min OTLP ingest rate limiter               │
│  - 30s WebSocket keepalive ping/pong heartbeat          │
│  - SPA Wildcard Fallback: app.get('*')                  │
└─────────────────────────────────────────────────────────┘
```

---

## 11. 📊 High-Scale Telemetry & Storage SLA Specifications

| Dimension | Specification | Verification / Implementation Metric |
| :--- | :--- | :--- |
| **Target Node Scale** | 2,000+ Servers & K8s Pods | Passive OTLP Push to `POST /v1/metrics` (67 pushes/sec at 30s interval) |
| **Internal Poller Fan-out** | 200 Hosts / 50 Concurrency Ceiling | Completed in **93.5ms** during scale test ([`tests/load_test_200.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/tests/load_test_200.js)) |
| **Credential Cache Hit Rate** | > 90% Sub-5ms Resolution | Tested at **91.5% hit rate** against CyberArk cache |
| **WebSocket Latency** | < 50ms Real-Time Push | Broadcast tick on state changes with 30s keepalive heartbeat |
| **Historical Data Retention** | 7-Day Partitioned Hypertables | TimescaleDB automated chunk drops to prevent disk inflation |
| **Local Cache Bounding** | Max 200 Items / 10MB Daily Log Stream | Memory prune in `packages/database/db.js`; enterprise rotating log in `packages/logger/logger.js` (10MB/1d/30 files) |

---

## 12. 🧪 Verification & Automated QA Matrix (12/12 Passed)

```
========================================================================
           PROJECT SENTINEL — QUALITY ASSURANCE VERIFICATION
========================================================================
 [1/12]  cyberark_provider.test.js           ✅ PASSED (Safe/Object resolution)
 [2/12]  auth_lockdown.test.js               ✅ PASSED (JWT role enforcement)
 [3/12]  schema_validation.test.js           ✅ PASSED (YAML schema integrity)
 [4/12]  telemetry_selector.test.js          ✅ PASSED (OTel Profile 1 switch)
 [5/12]  otlp_normalizer.test.js             ✅ PASSED (Semantic convention map)
 [6/12]  datastore_migration.test.js         ✅ PASSED (Rolling 200-item cap)
 [7/12]  misc_operations.test.js             ✅ PASSED (Custom check probes)
 [8/12]  prod_data_availability.test.js      ✅ PASSED (Data isolation)
 [9/12]  data_availability_segregation.test  ✅ PASSED (Concurrent collection)
[10/12]  env_strict_value_not_available.test ✅ PASSED (Strict prod/stg masking)
[11/12]  load_test_200.js                    ✅ PASSED (93ms 200-host sweep)
[12/12]  e2e_qa_suite.test.js                ✅ PASSED (End-to-end assurance)
========================================================================
REGRESSION SUITE STATUS: 12/12 PASSED (100% GREEN)
========================================================================
```

---

## 13. 🚀 CLI Commands Reference

| Task | Command | Description |
| :--- | :--- | :--- |
| **Windows Launch** | `start.bat` | One-click: installs deps across workspaces, compiles frontend, starts backend |
| **Production Start** | `npm start` | Starts Express + WebSocket server on `0.0.0.0:3001` |
| **Build Web Assets**| `npm run build` | Compiles Vite React bundle into `apps/web/dist/` |
| **Dev Mode** | `npm run dev` | Runs backend (`3001`) and Vite HMR (`5173`) concurrently |
| **Full QA Suite** | `node scratch/run_all_tests.js` | Executes all 12 regression test suites |
| **Install Service** | `powershell -File install_service.ps1` | Registers Windows Task Scheduler daemon |
