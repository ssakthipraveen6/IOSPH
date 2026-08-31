# Intelligent Observability & Autonomous Recovery Framework

An enterprise self-hosting observability portal that provides **real-time telemetry collection**, **local AI-driven log anomaly detection**, **autonomous self-healing runbooks**, and **four-eyes dual-approval governance** across core infrastructure and application layers.

Designed for deployment on **Windows Server** behind enterprise **AVI Load Balancers** and **RefWeb / IIS reverse proxies**, accessible to all team members via a corporate URL.

---

## 💻 Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19 + Vite, Pure CSS (Dark / Light theme), Custom SVG Analytics Charts |
| **Backend** | Node.js, Express, WebSockets (`ws`), HTTP Compression (`compression`) |
| **Storage** | PostgreSQL / TimescaleDB (metrics time-series), Snowflake (log analytics lake) |
| **Caching** | In-memory JSON DB (`sentinel_db.json`, rolling 200-item cap) |
| **Auth** | Enterprise eLDAP / Active Directory, JWT sessions, CyberArk CCP credential provider |
| **Telemetry** | OpenTelemetry OTLP/HTTP receiver, Dynatrace API v2, Prometheus Node Exporter |
| **Hosting** | Windows Server (IIS via `web.config` + HttpPlatformHandler) |
| **Load Balancer** | AVI Load Balancer Virtual Service with HTTPS health monitor probes |

---

## 📐 Architecture

```
Browser Users (via ordered URL / RefWeb)
        │
        ▼
AVI Virtual Service  ──── GET /api/healthz ──→ HTTP 200 UP
        │
        ▼
IIS (web.config + HttpPlatformHandler)
        │
        ▼
Node.js Express Backend  (0.0.0.0:3001)
  ├── GET  /api/health            Real-time environment health state
  ├── GET  /api/metrics           Historical time-series from PostgreSQL
  ├── POST /v1/metrics            OTLP/HTTP ingest from OTel Collector agents
  ├── GET  /api/alerts            Active alerts (environment-segregated)
  ├── GET  /api/yaml/*            GitOps YAML config read/write
  ├── POST /api/environment       Switch active environment (prod/staging/demo)
  ├── POST /api/auth/sso/login    eLDAP/AD SSO authentication
  └── WS   /ws                   Real-time telemetry WebSocket stream (30s heartbeat)
        │
        ├── Background Collectors (concurrent: prod + staging)
        │     ├── App Collector (Bitbucket, Artifactory, Jenkins, ArgoCD, ...)
        │     ├── Infra Collector (AVI, NAS, SSO, Windows, Linux, K8s)
        │     ├── Dynatrace Collector (API v2 metric sync)
        │     └── Fluentd Log Collector (real log paths)
        │
        ├── AI Analysis Engine (real_analyzer.js)
        │     └── Pattern-match alerts → Autonomous self-healing trigger
        │
        ├── Remediation Engine (recovery.js)
        │     └── Jenkins job triggers, four-eyes approval, recovery runbooks
        │
        └── Data Layer
              ├── PostgreSQL (time-series hypertable)
              ├── Snowflake (log analytics warehouse)
              └── JSON Cache (sentinel_db.json, 200-item rolling cap)
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js v18+
- Windows Server (or any OS for dev)

### Install & Run

**Option A — `start.bat` (Windows, one-click):**
```
Double-click start.bat
```
This auto-installs dependencies, builds the frontend, and starts the server.

**Option B — Manual:**
```powershell
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build frontend production assets
npm run build-frontend

# Start the server
npm start
```

**Access**: Navigate to `http://<SERVER_IP>:3001` (or your ordered corporate URL).

---

## ⚙️ Configuration

**All production URLs, AVI endpoints, and environment settings live in one file:**

### [`config/global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml) — Single Source of Truth

```yaml
environment: "production"   # Startup default environment (also switchable live via UI)
telemetry_provider: "hybrid"  # "opentelemetry" | "dynatrace" | "node_exporter" | "hybrid"

prod_urls:
  app_url: "https://<YOUR-ORDERED-APP-URL>"
  avi_virtual_service_url: "https://<YOUR-AVI-VS-URL>"
  avi_api: "https://avi-prod.internal.corp/api/v1/telemetry"
  sso_api: "https://sso-auth-prod.internal.corp/oauth2/token"
  db_jdbc: "jdbc:postgresql://db-prod-primary.internal.corp:5432/telemetry_db"
  nas_mount: "d:\\production_shares\\nas_logs"
  bitbucket_api: "https://bitbucket-prod.internal.corp/rest/api/1.0"
  # ... (see full file for all endpoints)

sso_ldap_config:
  enabled: true
  ldap_url: "ldaps://ldap.enterprise.corp:636"
  bind_dn: "cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp"
  # ...
```

### Per-Application YAML — [`config/applications/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/applications)

Each application has its own YAML topology file (`bitbucket.yaml`, `artifactory.yaml`, etc.) declaring its prod/staging endpoints, server hostnames, layers, and Jenkins remediation job.

---

## 🌐 OpenTelemetry Integration

Project Sentinel acts as a **passive OTLP/HTTP receiver** — no OTel SDK is embedded. Point your existing OTel Collector agents at the app:

```yaml
# otel-collector-config.yaml (deployed on each server / K8s DaemonSet)
exporters:
  otlphttp:
    endpoint: "https://<YOUR-ORDERED-APP-URL>/v1/metrics"
    headers:
      Authorization: "Bearer <sentinel_service_token>"

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, kubeletstats, jmx]
      exporters: [otlphttp]
```

**Supported OTel metric types**: `system.cpu.utilization`, `system.memory.utilization`, `system.filesystem.utilization`, `system.disk.io`, `system.network.io`, `jvm.memory.used`, `container.cpu.usage.total`, `k8s.pod.memory_working_set_bytes`, and all standard OTel semantic conventions.

---

## 🏗️ AVI Load Balancer Health Monitor

| Setting | Value |
| :--- | :--- |
| **Health Check Path** | `GET /api/healthz` |
| **Expected HTTP Status** | `200 OK` |
| **Expected Body** | `{ "status": "UP" }` |
| **Interval** | 15 seconds |

Additional probes also available: `/health`, `/status`, `/api/ping`.

---

## 🌍 Environment Switching (Prod / Staging / Demo)

The UI environment selector (`PROD` | `STAGING` | `DEMO`) dynamically controls:
- Which database environment rows are served in API responses
- Which collector endpoint URLs are used (prod vs staging)
- Whether `"Data Not Available"` is shown for missing feeds

**Background collection continues for both `prod` and `staging` concurrently regardless of which environment the UI is viewing.**

---

## 🧪 QA Test Suite

Run `npm test` — executes all 11 automated assurance suites:

```
✅ PASSED: CyberArk Credential Provider Lookup
✅ PASSED: Authentication Lockdown & JWT Role Enforcement
✅ PASSED: YAML Schema Validation
✅ PASSED: Telemetry Profile Selector (OTel / Dynatrace / Prometheus)
✅ PASSED: OTLP Metric Normalizer (OTel → Sentinel key mapping)
✅ PASSED: Datastore Migration & Rolling Cap Enforcement
✅ PASSED: Misc Operations & Custom Checks Registry
✅ PASSED: Production Data Availability Segregation
✅ PASSED: Concurrent Dual-Environment Collection
✅ PASSED: 200-Host Fan-out Concurrency Load Test
✅ PASSED: E2E QA Suite (DB, API, Recovery, Chaos Engineering)
```

---

## 🛡️ Windows Background Daemon (Task Scheduler)

To run the server continuously, surviving reboots:

```powershell
# Run as Administrator from the root workspace folder
Set-ExecutionPolicy Bypass -Scope Process -Force
./install_service.ps1
```

This registers the Node.js daemon with Windows Task Scheduler for automatic startup.

---

## 🛠️ Troubleshooting

**`vite is not recognized`**:
```powershell
cd frontend
npm install --no-audit --no-fund
npm run build
```

**Cannot reach backend**:
- Confirm `HOST=0.0.0.0` and `PORT=3001` are set (or not overridden to `127.0.0.1`).
- Confirm Windows Firewall allows inbound TCP on `3001` (or the IIS-forwarded port).
- Check IIS Application Pool identity has read/execute permissions on the workspace folder.

**WebSocket disconnects through AVI / RefWeb**:
- The 30-second WebSocket ping/pong heartbeat is built-in. Ensure the AVI Virtual Service idle timeout is ≥ 60 seconds.
