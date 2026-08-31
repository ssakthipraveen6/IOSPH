# 🏛️ Project Sentinel — Complete Architecture Diagrams & Blueprint Master Document
**Document:** `ARCHITECTURE_DIAGRAMS.md` | **Version:** `2.4.0-Enterprise` | **Classification:** `Tier-1 Production Blueprint`

---

## 📑 Quick Navigation
1. [Executive Blueprint (Visual)](#1-executive-architectural-blueprint)
2. [7-Tier Structural Topology](#2-7-tier-enterprise-topology)
3. [Interactive Data & Event Execution Flows](#3-end-to-end-data--event-execution-flows)
   - [Path A: User Traffic Flow](#path-a-user-traffic--websockets-flow)
   - [Path B: 2,000+ Node OpenTelemetry Ingestion Flow](#path-b-2000-node-opentelemetry-ingestion-flow)
   - [Path C: AI Anomaly Detection & Autonomous Recovery Flow](#path-c-ai-anomaly-detection--autonomous-recovery-flow)
4. [Dual-Environment Segregation Architecture](#4-dual-environment-segregation-architecture)
5. [Security, Identity & Vault Governance Architecture](#5-security-identity--vault-governance-architecture)
6. [Single Source of Truth (SSOT) Configuration Chain](#6-single-source-of-truth-ssot-configuration-chain)
7. [Telemetry Provider Profiles Matrix](#7-telemetry-provider-profiles-matrix)
8. [Network Ingress & Load Balancing Architecture](#8-network-ingress--load-balancing-architecture)

---

## 1. 🌟 Executive Architectural Blueprint

![Project Sentinel Executive Blueprint](./docs/images/executive_blueprint.jpg)

### Executive Architecture Overview
Project Sentinel is an enterprise observability and autonomous recovery platform designed for Tier-1 Windows Server environments behind corporate **AVI Load Balancers** and **RefWeb / IIS Reverse Proxies**. It ingests telemetry from **2,000+ servers** via passive OpenTelemetry OTLP push, runs real-time AI anomaly detection on log streams, and executes automated Jenkins self-healing runbooks under Four-Eyes governance.

---

## 2. 🏗️ 7-Tier Enterprise Topology

![Project Sentinel 7-Layer Architecture](./docs/images/7_layer_topology.jpg)

### Structural Tier Responsibilities

| Tier | Name | Technology Stack | Core Functionality |
| :---: | :--- | :--- | :--- |
| **1** | **Presentation Tier** | React 19 SPA, Vite, Pure CSS, SVG Charts | Dark/Light theme, multi-timezone clocks, zero client secrets, relative `/api` paths. |
| **2** | **Ingress & VIP Tier** | AVI Load Balancer, IIS, `web.config` | SSL offloading, `/api/healthz` health monitor, `HttpPlatformHandler` process bridge. |
| **3** | **Application Tier** | Node.js Express 4 (`0.0.0.0:3001`), `ws` | `trust proxy` header resolution, Gzip compression, rate limiters, 30s WS heartbeat. |
| **4** | **Services & AI Tier** | Async Tier Coordinator, Regex AI Engine | **Concurrent Dual-Collection (`prod` + `staging`)**; Four-Eyes Dual Approval governance. |
| **5** | **Ingestion & Vault Tier**| OTLP HTTP Ingest (`/v1/metrics`), CyberArk CCP | Ingests from **2,000+ server agents**; dynamic Safe/Object vault lookups. |
| **6** | **Persistence Tier** | PostgreSQL / TimescaleDB, Snowflake, JSON DB | 7-day partitioned hypertables; environment-segregated cache; 200-item rolling disk cap. |
| **7** | **Configuration Tier** | `global_config.yaml`, `applications/*.yaml` | **Single Source of Truth**; zero hardcoded IPs; Bitbucket PR GitOps automation. |

---

## 3. 🔄 End-to-End Data & Event Execution Flows

![Project Sentinel Data and Event Flow](./docs/images/data_flow_diagram.jpg)

---

### Path A: User Traffic & WebSockets Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Enterprise User
    participant AVI as AVI Virtual Service
    participant IIS as Windows Server IIS (web.config)
    participant EXP as Express Backend (0.0.0.0:3001)
    participant WS as WebSocket Server (/ws)
    participant UI as React 19 Dashboard

    User->>AVI: HTTPS GET https://sentinel-observability.internal.corp
    Note over AVI: SSL Offload, Inject X-Forwarded-For<br/>Periodic health check: GET /api/healthz (200 UP)
    AVI->>IIS: Reverse Proxy forward to port 3001
    IIS->>EXP: HttpPlatformHandler dispatches request
    EXP->>UI: Serve compiled SPA (frontend/dist)
    UI->>WS: Establish wss://<HOST>/ws connection
    EXP->>WS: Start 30s Ping/Pong Heartbeat
    WS-->>UI: Push 'init' payload (Health, Alerts, Metrics, Approvals)
    Note over UI: Dashboard renders live tiles and sparklines
```

---

### Path B: 2,000+ Node OpenTelemetry Ingestion Flow

```mermaid
sequenceDiagram
    autonumber
    participant Server as 2,000+ Servers (Linux / Win / K8s)
    participant OTel as Local OTel Collector Agent
    participant Ingest as POST /v1/metrics (Sentinel API)
    participant Norm as otlp_metric_normalizer.js
    participant DB as db.js (ENV-Isolated Cache)
    participant PG as PostgreSQL (TimescaleDB)
    participant WS as WebSocket Broadcast
    participant UI as Application Dashboard Tile

    Server->>OTel: Collect system.cpu, jvm.memory, cgroups
    Note over OTel: Attaches resource.attributes:<br/>application.id = "jenkins_k8s"<br/>host.name = "jenkins-prod-01"<br/>environment = "prod"
    OTel->>Ingest: POST /v1/metrics (every 30s)
    Note over Ingest: Rate limiter: 1,000 req/min per IP
    Ingest->>Norm: normalizeOtlpPayload(payload)
    Note over Norm: Resolves application.id → "jenkins_k8s"<br/>Normalizes system.cpu.utilization → "cpu"<br/>Scales decimal to 0-100%
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
    participant Log as Fluentd Log Collector (NAS mount)
    participant AI as real_analyzer.js
    participant DB as db.js Alerts Store
    participant Gov as Four-Eyes Approval Queue
    participant Rec as recovery.js Orchestrator
    participant Jen as Jenkins CI/CD Webhook
    participant WS as WebSocket Stream
    participant UI as CommandCenter View

    Log->>AI: analyzeServerLogs(rawLogs, env="prod")
    Note over AI: Scans regex patterns:<br/>/OutOfMemoryError|Java heap space/i<br/>Match found on component: "jenkins_k8s"
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

## 4. 🌍 Dual-Environment Segregation Architecture

Project Sentinel ensures that switching the UI environment never halts background collection for either tier:

```mermaid
flowchart TD
    subgraph UI_CONTROL["Frontend Environment Selector"]
        BTN["User Clicks: PROD | STAGING | DEMO"]
    end

    subgraph API_SWITCH["Express Runtime Controller"]
        SW["POST /api/environment\nruntimeEnvironment = 'prod'\nglobal.runtimeEnvironment = 'prod'"]
    end

    subgraph DUAL_COLLECTOR["collector_coordinator.js (Background Daemon)"]
        LOOP["Continuous Tiered Polling Loop\nfor env of ['staging', 'prod']"]
        P_COL["Collect Prod Telemetry\n(prod_urls & real endpoints)"]
        S_COL["Collect Staging Telemetry\n(stg_urls & staging endpoints)"]
    end

    subgraph STORAGE_LAYER["db.js Multi-Environment Store"]
        M_PROD["db.metrics.prod [ ]\n(Tagged with env='prod')"]
        M_STG["db.metrics.staging [ ]\n(Tagged with env='staging')"]
        M_DEMO["db.metrics.demo [ ]\n(Simulated demo feeds)"]
    end

    subgraph API_SERVING["API Response Filtering Layer"]
        R_PROD["GET /api/health?env=prod ──► Serves ONLY prod metrics"]
        R_STG["GET /api/health?env=staging ──► Serves ONLY staging metrics"]
        R_DNA["No data for component in env ──► Displays 'Data Not Available'"]
    end

    BTN --> SW
    SW --> API_SERVING

    LOOP --> P_COL & S_COL
    P_COL --> M_PROD
    S_COL --> M_STG

    M_PROD --> R_PROD
    M_STG --> R_STG
    R_PROD & R_STG --> R_DNA

    style DUAL_COLLECTOR fill:#132e1b,color:#fff,stroke:#00cc66
    style STORAGE_LAYER fill:#0f2744,color:#fff,stroke:#0099ff
```

---

## 5. 🛡️ Security, Identity & Vault Governance Architecture

```mermaid
flowchart TD
    subgraph SSO_AUTH["1. Identity & Single Sign-On"]
        LDAP["Active Directory / eLDAP Bind\n(ldaps://ldap.enterprise.corp:636)"]
        JWT["Signed JWT Session Token\n(Cookie / Authorization Header)"]
        RBAC["Role-Based Access Control:\n- Super-Admin\n- SRE Lead\n- NOC Operator\n- Security Auditor"]
    end

    subgraph VAULT_SECURITY["2. Credential Vault Integration"]
        CCP["CyberArk Central Credential Provider (CCP)\nGET /AIMWebService/api/Accounts"]
        REG["config/cyberark/registry.yaml\n(Safe: APP_PROD_VAULT, Object: svc_db_account)"]
        CACHE["In-Memory Credential Cache\n(Sub-5ms resolution, 91.5% hit rate)"]
        FALLBACK["Environment Variable Fallback\n(PGUSER, PGPASSWORD, etc.)"]
    end

    subgraph GOVERNANCE["3. Operational Governance"]
        FE["Four-Eyes Dual Approval Queue\n(Requires 2 authorized sign-offs)"]
        AUDIT["Immutable Audit Log\n(/api/audit/logs)"]
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

## 6. ⚙️ Single Source of Truth (SSOT) Configuration Chain

```mermaid
flowchart TD
    subgraph YAML_FILES["Declarative YAML Files (config/)"]
        GY["global_config.yaml\n- environment\n- prod_urls (app_url, avi_vs, db_jdbc, nas_mount...)\n- stg_urls\n- sso_ldap_config"]
        AY["applications/*.yaml\n(13 apps: bitbucket.yaml, artifactory.yaml, jenkins_k8s.yaml...)"]
        IY["infrastructure/*.yaml\n(7 layers: avi.yaml, windows.yaml, unix.yaml, sso_eldap.yaml...)"]
        TP["telemetry_profiles.yaml\n(selected_profile: 1)"]
        CY["cyberark/registry.yaml\n(Vault Safe/Object mappings)"]
    end

    subgraph PARSERS["Loader & Parser Modules"]
        YC["yaml_config.js\n- loadGlobalConfig()\n- loadAllApplications()\n- loadAllInfrastructureLayers()"]
        CF["config/config.js\n- Dynamic ACTIVE_URLS getter\n- PROD_URLS & STG_URLS objects\n- ENVIRONMENT constant\n- USE_SIMULATED_COLLECTORS=false"]
        TPS["telemetry_provider_selector.js\n- getActiveStrategy()\n- shouldRunCollector(key)"]
        CP["cyberark/credential_provider.js\n- getCredential(appId, purpose)"]
    end

    subgraph CONSUMERS["Core Runtime Consumers"]
        SRV["backend/server.js\n(REST Routes, CORS, Rate Limiters)"]
        COORD["metrics_collection/collector_coordinator.js\n(Tiered collection loops)"]
        GITOPS["frontend/src/components/YamlConfigManager.jsx\n(In-browser editor + Bitbucket PRs)"]
    end

    GY & AY & IY --> YC --> CF
    TP --> TPS
    CY --> CP

    CF --> SRV & COORD & GITOPS
    TPS --> COORD
    CP --> COORD & SRV

    style YAML_FILES fill:#4d3900,color:#fff,stroke:#ffcc00
    style PARSERS fill:#0f2744,color:#fff,stroke:#0099ff
    style CONSUMERS fill:#132e1b,color:#fff,stroke:#00cc66
```

---

## 7. 🌐 Network Ingress & Load Balancing Architecture

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
│             NODE.JS EXPRESS 4 DAEMON                    │
│  - trust proxy = true                                   │
│  - compression() Gzip middleware                        │
│  - 2,000 req/min API rate limiter                       │
│  - 1,000 req/min OTLP ingest rate limiter               │
│  - 30s WebSocket keepalive ping/pong heartbeat          │
│  - SPA Wildcard Fallback: app.get('*')                  │
└─────────────────────────────────────────────────────────┘
```

---

## 8. 🧪 Verification & Automated QA Suite (11/11 Passed)

```
========================================================================
           PROJECT SENTINEL — QUALITY ASSURANCE VERIFICATION
========================================================================
 [1/11]  cyberark_provider.test.js           ✅ PASSED (Safe/Object resolution)
 [2/11]  auth_lockdown.test.js               ✅ PASSED (JWT role enforcement)
 [3/11]  schema_validation.test.js           ✅ PASSED (YAML schema integrity)
 [4/11]  telemetry_selector.test.js          ✅ PASSED (OTel Profile 1 switch)
 [5/11]  otlp_normalizer.test.js             ✅ PASSED (Semantic convention map)
 [6/11]  datastore_migration.test.js         ✅ PASSED (Rolling 200-item cap)
 [7/11]  misc_operations.test.js             ✅ PASSED (Custom check probes)
 [8/11]  prod_data_availability.test.js      ✅ PASSED (Data isolation)
 [9/11]  data_availability_segregation.test  ✅ PASSED (Concurrent collection)
[10/11]  load_test_200.js                    ✅ PASSED (93ms 200-host sweep)
[11/11]  e2e_qa_suite.test.js                ✅ PASSED (End-to-end assurance)
========================================================================
```
