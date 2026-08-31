# 🏛️ Technical Architecture Document (TAD)
## Project Sentinel — Intelligent Observability & Autonomous Recovery Framework
**Document Version:** `2.4.0-Enterprise` | **Classification:** `Tier-1 Production Blueprint` | **Target Deployment:** `Windows Server / AVI VIP`

---

## 1. 🌟 Executive Architectural Blueprint

![Project Sentinel Executive Blueprint](C:\Users\sspra\.gemini\antigravity-ide\brain\f41950a6-08c0-49c5-a6e7-02892bab6cf0\executive_enterprise_blueprint_1788187876034.jpg)

---

## 2. 🏗️ 7-Layer Enterprise Topology

![Project Sentinel 7-Layer Architecture](C:\Users\sspra\.gemini\antigravity-ide\brain\f41950a6-08c0-49c5-a6e7-02892bab6cf0\sentinel_architecture_diagram_1788187671972.jpg)

### Layer Responsibilities & Component Mappings

| Layer | Functional Domain | Core Technologies | MNC Compliance & Hardening Controls |
| :--- | :--- | :--- | :--- |
| **Layer 1: Presentation** | Enterprise Browser Portal | React 19 SPA, Vite, Pure CSS Variables, SVG Analytics | Accessible via corporate URL / RefWeb; zero client bundle secrets; relative `/api` paths. |
| **Layer 2: Ingress & VIP** | Network Routing & Offload | AVI Load Balancer Virtual Service, IIS ARR, `web.config` | SSL/TLS Offloading, `/api/healthz` health monitoring, `HttpPlatformHandler` process proxy. |
| **Layer 3: Core Application** | REST API & WS Engine | Node.js Express 4 (`0.0.0.0:3001`), `ws` WebSockets | `trust proxy` X-Forwarded headers, Gzip compression, 2,000 req/min rate limiters, 30s WS keepalive. |
| **Layer 4: Background Services** | Distributed Collectors & AI | Tiered Async Coordinator (10s/30s/120s), Regex AI Classifier | **Concurrent Dual-Collection (`prod` + `staging`)**; Four-Eyes Dual Approval governance for runbooks. |
| **Layer 5: Ingestion & Vault** | Fleet Agent & Secret Ingest | OpenTelemetry OTLP/HTTP Receiver (`/v1/metrics`), CyberArk CCP | Passive OTLP ingest from **2,000+ server agents**; dynamic CyberArk Safe/Object vault lookups. |
| **Layer 6: Persistence** | Multi-Tier Telemetry Store | PostgreSQL / TimescaleDB, Snowflake Warehouse, JSON DB | 7-day partitioned hypertables; environment-segregated cache; 200-item rolling disk cap. |
| **Layer 7: Configuration** | Declarative GitOps SSOT | [`config/global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml), `applications/*.yaml` | Centralized Single Source of Truth; zero hardcoded IP addresses; Bitbucket PR GitOps sync. |

---

## 3. 🔄 End-to-End Data & Event Execution Flows

![Project Sentinel Data and Event Flow](C:\Users\sspra\.gemini\antigravity-ide\brain\f41950a6-08c0-49c5-a6e7-02892bab6cf0\sentinel_data_flow_diagram_1788187704114.jpg)

### Detailed Flow Path Specifications

```mermaid
graph LR
    subgraph PATH_A["Path A: User Interaction (HTTPS / WS)"]
        direction TB
        A1["Browser Client"] -->|HTTPS| A2["AVI Load Balancer VIP"]
        A2 -->|Proxy| A3["IIS HttpPlatformHandler"]
        A3 -->|HTTP/WS| A4["Node.js Express Engine"]
        A4 -->|Broadcast| A5["Live React Dashboard Tiles"]
    end

    subgraph PATH_B["Path B: OpenTelemetry Ingestion (2000+ Nodes)"]
        direction TB
        B1["2000+ Server OTel Agents"] -->|POST /v1/metrics (30s)| B2["Sentinel OTLP Receiver"]
        B2 -->|Normalize| B3["otlp_metric_normalizer.js"]
        B3 -->|Save| B4["TimescaleDB Hypertables"]
        B4 -->|Broadcast| B5["Real-Time Sparklines & Alerts"]
    end

    subgraph PATH_C["Path C: AI Anomaly & Self-Healing (Runbooks)"]
        direction TB
        C1["Fluentd NAS Log Stream"] -->|Parse| C2["real_analyzer.js Regex Classifier"]
        C2 -->|Trigger| C3{"Autonomous Mode?"}
        C3 -->|Yes| C4["Jenkins Job Webhook Execution"]
        C3 -->|No| C5["Four-Eyes Dual Approval Queue"]
    end

    style PATH_A fill:#0f2744,color:#fff,stroke:#0099ff
    style PATH_B fill:#0b332b,color:#fff,stroke:#00cc88
    style PATH_C fill:#3b2a00,color:#fff,stroke:#ffaa00
```

---

## 4. 🛡️ Security, Identity & Vault Governance Matrix

```
                 ┌──────────────────────────────────────┐
                 │       eLDAP / Active Directory       │
                 └──────────────────┬───────────────────┘
                                    │
                         SSO Authentication Bind
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      SENTINEL SECURITY BOUNDARY                        │
│                                                                        │
│  [JWT Signed Session] ──► [Role-Based Access Control (RBAC)]           │
│                                   │                                    │
│                    ┌──────────────┴──────────────┐                     │
│                    ▼                             ▼                     │
│           Super-Admin / SRE             NOC / Read-Only                │
│       (Full Runbook & Config Edit)    (Dashboard & Metrics Only)       │
│                    │                                                   │
│                    ▼                                                   │
│     [Four-Eyes Dual Approval Queue] ──► [Jenkins Remediation Webhook]   │
└────────────────────┬───────────────────────────────────────────────────┘
                     │
         Dynamic Credential Lookup
                     │
                     ▼
         ┌───────────────────────┐
         │     CyberArk CCP      │
         │   Safe / Object API   │
         └───────────────────────┘
```

| Security Area | Implementation Standard | Source File Reference |
| :--- | :--- | :--- |
| **Authentication & SSO** | Active Directory / eLDAP Bind Client with signed JWT tokens | [`backend/auth/ldap_client.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/auth/ldap_client.js) |
| **Credential Management** | CyberArk Central Credential Provider (CCP) with in-memory caching | [`config/cyberark/credential_provider.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/cyberark) |
| **Network Protection** | Helmet (CSP, HSTS, X-Frame-Options), Enterprise CORS Allowlist | [`backend/server.js:30-75`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js) |
| **Rate Limiting (DDoS)** | 2,000 req/min API, 1,000 req/min OTLP, 50 req/15min Auth | [`backend/server.js:95-120`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js) |
| **Change Governance** | Dual-Signoff Four-Eyes Approval on automated Jenkins runbooks | [`remediation/recovery.js:40-90`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/recovery.js) |

---

## 5. 🌐 Network Ingress, Routing & Load Balancing

```
[Corporate Intranet / RefWeb]
               │
      HTTPS (Port 443)
               │
               ▼
[AVI Load Balancer Virtual Service]
   ├── VIP IP: Assigned by NetOps
   ├── Health Monitor: GET /api/healthz (HTTP 200 = UP every 15s)
   ├── SSL Offload / Re-encryption
   └── X-Forwarded-For / Proto Injection
               │
      HTTP/HTTPS (Port 3001 or Dynamic)
               │
               ▼
[Windows Server IIS Instance]
   ├── web.config HttpPlatformHandler
   ├── Native IIS WebSocket Pass-Through (30s ping)
   └── Dynamic & Static URL Compression
               │
               ▼
[Node.js Express Daemon (0.0.0.0:3001)]
```

---

## 6. 📊 High-Scale Telemetry & Storage SLA Specifications

| Dimension | Specification | Verification / Implementation Metric |
| :--- | :--- | :--- |
| **Target Node Scale** | 2,000+ Servers & K8s Pods | Passive OTLP Push to `POST /v1/metrics` (67 pushes/sec at 30s interval) |
| **Internal Poller Fan-out** | 200 Hosts / 50 Concurrency Ceiling | Completed in **93.5ms** during scale test ([`load_test_200.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/tests/load_test_200.js)) |
| **Credential Cache Hit Rate** | > 90% Sub-5ms Resolution | Tested at **91.5% hit rate** against CyberArk cache |
| **WebSocket Latency** | < 50ms Real-Time Push | Broadcast tick on state changes with 30s keepalive heartbeat |
| **Historical Data Retention** | 7-Day Partitioned Hypertables | TimescaleDB automated chunk drops to prevent disk inflation |
| **Local Cache Bounding** | Max 200 Items / Max 500KB Log | Memory prune in `db.js`; single rotating 500KB master stream in `logger.js` |

---

## 7. 📁 Single Source of Truth Directory Hierarchy

```
config/
├── global_config.yaml          # ⭐ PRIMARY SINGLE SOURCE OF TRUTH
│                               #    - environment: "production"
│                               #    - prod_urls (app_url, avi_vs, db_jdbc, nas_mount, apis...)
│                               #    - stg_urls
│                               #    - sso_ldap_config
├── applications/               # 📁 13 Declarative App Topologies
│   ├── bitbucket.yaml          #    (Endpoints, Server Nodes, Layers, Jenkins Job)
│   ├── artifactory.yaml
│   ├── jenkins_k8s.yaml
│   ├── argocd.yaml
│   └── ...
├── infrastructure/             # 📁 7 Core Infrastructure Layers
│   ├── avi.yaml                #    (AVI Load Balancer telemetry)
│   ├── windows.yaml            #    (Windows Server compute pool)
│   ├── unix.yaml               #    (Linux Server compute pool)
│   ├── sso_eldap.yaml          #    (eLDAP gateway metrics)
│   └── k8s.yaml
├── telemetry_profiles.yaml      # 📁 Master Profile Selector (Profile 1: OTel default)
└── cyberark/
    └── registry.yaml           # 📁 Safe & Object Name Vault Mapping
```

---

## 8. 🧪 Automated System Assurance Matrix (11/11 Passed)

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
