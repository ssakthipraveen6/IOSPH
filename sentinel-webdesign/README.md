# 🏛️ Intelligent Observability & Autonomous Recovery Framework (Project Sentinel)

An enterprise self-hosting observability portal providing **real-time telemetry collection**, **local AI-driven log anomaly detection**, **autonomous self-healing runbooks**, and **four-eyes dual-approval governance** across core infrastructure and application layers.

Designed for deployment on **Windows Server** behind enterprise **AVI Load Balancers** and **RefWeb / IIS reverse proxies**, accessible to enterprise teams via corporate URLs.

---

## 📚 Consolidated Documentation Map

The project's architectural and operational documentation is consolidated into two authoritative master documents:

| Document | File Link | Description |
| :--- | :--- | :--- |
| **Master Architecture & Reference** | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | **Definitive Single Source of Truth**: 7-tier monorepo topology, Mermaid sequence & state diagrams, module-by-module code reference, OpenTelemetry implementation, toggles, and SLAs. |
| **Production Integration Guide** | [`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md) | **Step-by-step rollout manual**: Exact line numbers, configuration points, TimescaleDB SQL DDL, CyberArk CCP registry, deep code scan report, and deployment checklists. |
| **Interactive Blueprint Viewer** | [`docs/ARCHITECTURE_DIAGRAMS.html`](./docs/ARCHITECTURE_DIAGRAMS.html) | Standalone dark-mode HTML viewer with interactive Mermaid.js architecture diagrams. |
| **UI/UX Design Standards** | [`docs/design_gallery.html`](./docs/design_gallery.html) | Interactive developer dark vs. MNC glassmorphism design gallery. |
| **Security Policy** | [`SECURITY.md`](./SECURITY.md) | Vulnerability disclosure, vault scoping, JWT sessions, and audit logging standards. |

---

## 💻 Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19 + Vite, Pure CSS (Dark / Light theme), Custom SVG Analytics Charts (`apps/web`) |
| **Backend** | Node.js, Express 4, WebSockets (`ws`), HTTP Compression (`apps/api` on `0.0.0.0:3001`) |
| **Collectors & AI**| Tiered Async Coordinator, Headless Python Selenium Probers, Regex AI Classifier (`apps/collector`) |
| **Storage** | PostgreSQL / TimescaleDB (metrics time-series), Snowflake (log analytics warehouse) (`packages/database`) |
| **Caching** | In-memory write-behind cache (`.runtime/sentinel_db.json`, rolling 200-item cap) |
| **Auth & Security**| Enterprise eLDAP / Active Directory, JWT sessions, CyberArk CCP credential provider (`packages/auth`) |
| **Telemetry** | Profile 1: OpenTelemetry OTLP/HTTP push (`/v1/metrics`) + synthetic probers; Profile 2: Dynatrace API v2 |
| **Hosting** | Windows Server (native IIS via `web.config` + `HttpPlatformHandler` process bridge) |
| **Load Balancer** | AVI Load Balancer Virtual Service with HTTPS health monitor probes (`/api/healthz`) |

---

## 📐 Architecture Overview

```
Browser Users (via Corporate URL / RefWeb)
        │
        ▼
AVI Virtual Service  ──── GET /api/healthz ──→ HTTP 200 UP
        │
        ▼
Windows Server IIS (web.config + HttpPlatformHandler)
        │
        ▼
Node.js Express Backend (apps/api - 0.0.0.0:3001)
  ├── GET  /api/healthz           AVI / RefWeb health monitor probe (200 UP)
  ├── GET  /api/health            Real-time environment health state
  ├── GET  /api/metrics           Historical time-series from PostgreSQL / TimescaleDB
  ├── POST /v1/metrics            OTLP/HTTP ingest from 2,000+ host OTel agents
  ├── GET  /api/alerts            Active alerts (environment-segregated)
  ├── GET  /api/yaml/*            GitOps YAML config read / write
  ├── POST /api/environment       Switch active environment (prod/staging/demo)
  ├── POST /api/auth/sso/login    eLDAP / AD SSO authentication
  └── WS   /ws                    Real-time telemetry WebSocket stream (30s heartbeat)
        │
        ├── Background Collectors (apps/collector - concurrent: prod + staging)
        │     ├── App Collector (32 scrapers: Bitbucket, Artifactory, Jenkins, ArgoCD...)
        │     ├── Infra Collector (AVI, NAS, SSO, Windows, Linux, K8s, Firewall)
        │     ├── Dynatrace Collector (Standalone fetchHostManagementMetrics API)
        │     ├── Python Synthetic Prober (Headless Selenium SSO login checks)
        │     └── Fluentd Log Collector (Real NAS log mount reader)
        │
        ├── AI Analysis Engine (apps/collector/src/ai_analysis/real_analyzer.js)
        │     └── Pattern-match alerts → Autonomous self-healing trigger
        │
        ├── Remediation Engine (apps/collector/src/remediation/recovery.js)
        │     └── Jenkins job triggers, Four-Eyes dual-approval queue, runbooks
        │
        └── Data Layer (packages/database)
              ├── PostgreSQL / TimescaleDB (time-series hypertables)
              ├── Snowflake (log analytics warehouse)
              └── In-Memory Cache (.runtime/sentinel_db.json, 200-item cap)
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js v18+ (tested on v20 LTS)
- Windows Server (or Windows 10/11 for local development)
- Python 3.10+ (for synthetic browser prober checks)

### Install & Run

**Option A — `start.bat` (Windows, One-Click):**
```cmd
Double-click start.bat
```
This automatically installs dependencies across workspaces, compiles the frontend bundle, and launches the server.

**Option B — Manual CLI:**
```powershell
# Install root and workspace dependencies
npm install

# Build frontend production bundle
npm run build

# Start the Express server
npm start
```

**Development Mode (HMR Frontend + API Backend):**
```powershell
npm run dev
```

**Access**: Open `http://localhost:3001` or your assigned corporate RefWeb URL.

---

## ⚙️ Configuration — Single Source of Truth

All environment settings, vendor endpoints, master toggles, and component switches are managed declaratively in one file:

### [`packages/config/global_config.yaml`](./packages/config/global_config.yaml)

```yaml
# Startup environment: "production" | "staging" | "demo"
environment: "production"

# Profile 1 (Default): OpenTelemetry OTLP Push + Synthetic Probers
telemetry_profile: 1

# Master Collector Toggles
collectors:
  dynatrace:
    enabled: false               # Enable to query Dynatrace API v2
  python_metrics:
    enabled: true                # Enable headless Selenium browser prober checks

# Granular Infrastructure Component Switches
components_enabled:
  k8s: true
  avi: true
  nas: true
  sso_eldap: true
  windows: true
  unix: true
  firewall: true
  database: true

# Granular Application Topology Switches
applications_enabled:
  bitbucket: true
  jenkins_k8s: true
  artifactory: true
  argocd: true
  # ... (see global_config.yaml for full list)
```

---

## 🌐 OpenTelemetry Implementation (Profile 1 Default)

Project Sentinel operates as a **passive OTLP/HTTP receiver** for distributed server fleets:

1. **Ingest Endpoint**: `POST /v1/metrics`
2. **Normalizer**: `apps/api/src/otlp_metric_normalizer.js` automatically maps standard OpenTelemetry semantic conventions (`system.cpu.utilization`, `system.memory.utilization`, `jvm.memory.used`, etc.) to Sentinel dashboard telemetry keys (`cpu`, `memory`, `disk`, `latency`).
3. **Collector Agent Config (`otel-collector-config.yaml`)**:
```yaml
exporters:
  otlphttp:
    endpoint: "https://sentinel-observability.internal.corp/v1/metrics"
    headers:
      Authorization: "Bearer <sentinel_token>"

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      exporters: [otlphttp]
```

*For complete implementation details and configuration specs, see [Section 7 of ARCHITECTURE.md](./ARCHITECTURE.md#7-step-by-step-opentelemetry-implementation-guide).*

---

## 🔍 Standalone Dynatrace Host/Management API

When host or management-level visibility is needed from Dynatrace, Sentinel includes a dedicated, decoupled function:
- **Location**: [`apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector.js`](./apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector.js)
- **Function**: `fetchHostManagementMetrics(env)`
- **Toggle**: Honors `collectors.dynatrace.enabled` in `global_config.yaml`. When disabled, it immediately returns `{ status: 'DISABLED' }` with zero outbound network calls.

---

## 🌍 Strict Environment Segregation & Demo Lifecycle

1. **Startup Lifecycle**: On server boot, background polling initializes strictly for `prod` and `staging`. Simulated demo collectors are completely dormant.
2. **On-Demand Demo**: Demo generation starts ONLY when a user selects `DEMO` in the UI.
3. **Safe Teardown**: When the UI switches back to `PROD` or `STAGING`, demo loops are immediately halted and demo cache entries are wiped, ensuring simulated data never pollutes production dashboards.

---

## 🏗️ AVI Load Balancer Health Monitor

| Setting | Value |
| :--- | :--- |
| **Health Check Path** | `GET /api/healthz` |
| **Expected HTTP Status** | `200 OK` |
| **Expected Body** | `{ "status": "UP" }` |
| **Check Interval** | 15 seconds |

---

## 🧪 Automated QA Test Suite (12/12 Passed)

Run the full automated regression suite:
```powershell
node scratch/run_all_tests.js
```

```
[1/12] tests/cyberark_provider.test.js...             ✅ PASSED
[2/12] tests/auth_lockdown.test.js...                 ✅ PASSED
[3/12] tests/schema_validation.test.js...             ✅ PASSED
[4/12] tests/telemetry_selector.test.js...            ✅ PASSED
[5/12] tests/otlp_normalizer.test.js...               ✅ PASSED
[6/12] tests/datastore_migration.test.js...           ✅ PASSED
[7/12] tests/misc_operations.test.js...               ✅ PASSED
[8/12] tests/prod_data_availability.test.js...        ✅ PASSED
[9/12] tests/data_availability_segregation.test.js...   ✅ PASSED
[10/12] tests/env_strict_value_not_available.test.js... ✅ PASSED
[11/12] tests/load_test_200.js...                      ✅ PASSED
[12/12] tests/e2e_qa_suite.test.js...                  ✅ PASSED

=============================================
AUTOMATED REGRESSION SUITE: 12/12 PASSED (100% GREEN)
=============================================
```

---

## 🛡️ Windows Background Daemon Registration

To install Sentinel as an automatic Windows background daemon surviving host reboots:

```powershell
# Run from Administrator PowerShell terminal
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install_service.ps1
```
