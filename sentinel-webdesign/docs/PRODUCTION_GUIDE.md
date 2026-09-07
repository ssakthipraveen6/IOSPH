# 🚀 Project Sentinel — Production Integration & Deployment Guide

**Document:** `PRODUCTION_GUIDE.md` | **Version:** `4.0.0-Enterprise` | **Classification:** `Tier-1 Production Blueprint`  
**Target Platform:** Windows Server 2019/2022, AVI Vantage Load Balancer, RefWeb / IIS Reverse Proxy, PostgreSQL / TimescaleDB, OpenTelemetry OTLP Fleet.

---

## 📑 Table of Contents
1. [Executive Architecture Baseline](#1-executive-architecture-baseline)
2. [Production Directory Structure](#2-production-directory-structure)
3. [Step-by-Step Production Integration Blueprint](#3-step-by-step-production-integration-blueprint)
   - [Step 1: Configuration Management (`config/global.yaml` & `config/apps/*.yaml`)](#step-1-configuration-management-configglobalyaml--configappsyaml)
   - [Step 2: CyberArk Vault Integration (`config/cyberark.yaml`)](#step-2-cyberark-vault-integration-configcyberarkyaml)
   - [Step 3: PostgreSQL / TimescaleDB Setup (`database/postgres.js`)](#step-3-postgresql--timescaledb-setup-databasepostgresjs)
   - [Step 4: OpenTelemetry Fleet Ingestion (`POST /v1/metrics` & Normalizer)](#step-4-opentelemetry-fleet-ingestion-post-v1metrics--normalizer)
   - [Step 5: Telemetry Collection & Standalone Dynatrace Integration](#step-5-telemetry-collection--standalone-dynatrace-integration)
   - [Step 6: Log Streaming & AI Anomaly Detection](#step-6-log-streaming--ai-anomaly-detection)
   - [Step 7: Windows Server IIS & AVI Load Balancer Deployment](#step-7-windows-server-iis--avi-load-balancer-deployment)
4. [Master Verification & Regression Protocol](#4-master-verification--regression-protocol)

---

## 1. Executive Architecture Baseline

Project Sentinel is an enterprise observability and autonomous recovery platform architected with a **clean, 1-level flat structure**:
* **`backend/`**: Express 4 API backend, WebSockets (`/ws`), OTLP HTTP ingestion receiver (`POST /v1/metrics`), AVI health probes (`/healthz`, `/api/healthz`), audit logging, and RBAC authentication (`backend/server.js`).
* **`config/`**: Dedicated single source of truth for user configurations. Strict separation of concerns: contains purely YAML declarations (`global.yaml`, `telemetry.yaml`, `cyberark.yaml`, `apps/`, `infra/`).
* **`frontend/`**: React 19 + Vite dashboard organized into domain pods (`health/`, `sre/`, `analytics/`, `correlation/`, `admin/`, `shared/`) with strict `"Value Not Available"` isolation for unmonitored services in production and staging. Compiled to `frontend/dist/`.
* **`metrics_collection/`**: Tiered collection daemon (`collector_coordinator.js`), telemetry strategy selector (`telemetry_provider_selector.js`), and OTel normalizers.
* **`logs_collection/`**: Fluentd, Splunk, and Elasticsearch structured log streaming.
* **`ai_analysis/`**: Root-cause analysis engine, predictive analytics, and team rota schedule manager.
* **`remediation/`**: Automated self-healing orchestrators, Jenkins triggers, and Four-Eyes dual-approval governance.
* **`database/`**: PostgreSQL / TimescaleDB client, Snowflake adapter, and write-behind cache (`database/db.js`).
* **`logger/`**: Winston rotating audit logger.
* **`shared/`**: Central severity constants and error classes (`@sentinel/shared-constants`).

### Key Operational Rules:
1. **Profile 1 Active by Default**: Standard CNCF OpenTelemetry Collectors stream host OS metrics (`system.cpu`, `system.memory`, `system.disk`), JVM heap, and container cgroups via standard OTLP pushes. Redundant host collectors are skipped to eliminate duplicate overhead.
2. **Startup Collection Lifecycle**: On server startup, background telemetry polling runs for **`staging` and `prod` ONLY**. Demo simulation remains inactive (`isDemoActive = false`). Demo telemetry starts **only** when the user explicitly clicks the `DEMO` environment button in the dashboard, and **immediately halts** (clearing all chaos simulations) when switching back to `prod` or `staging`.
3. **Strict Data Segregation**: In `prod` and `staging`, unmonitored services explicitly render `"Value Not Available"`; mock or synthetic metrics are never allowed to leak into production views.

---

## 2. Production Directory Structure

```text
sentinel-webdesign/
├── ai_analysis/                  # AI root-cause analysis & rota engine
├── backend/                      # Express API server & routes
│   ├── auth/                     # eLDAP / Active Directory client & JWT session
│   ├── config/                   # Backend YAML loader & GitOps PR service
│   ├── services/                 # Health calculator & telemetry resolvers
│   └── server.js                 # Production API & WebSocket entry point
├── config/                       # ⭐ Single source of truth for user configuration
│   ├── .env.example              # Environment variables template
│   ├── README.md                 # Config onboarding guide
│   ├── global.yaml               # Master environment URLs & toggles
│   ├── telemetry.yaml            # Telemetry profiles (OTel, Dynatrace, Prometheus)
│   ├── cyberark.yaml             # CyberArk CCP Safe & Account Object registry
│   ├── apps/*.yaml               # 20 monitored toolchain topologies
│   └── infra/*.yaml              # 7 shared infrastructure topologies
├── database/                     # PostgreSQL / TimescaleDB & Snowflake client
├── deployments/                  # Windows deployment manifests & IIS configs
├── docs/                         # Authoritative documentation suite
│   ├── ARCHITECTURE.md           # Master architecture & design reference
│   ├── PRODUCTION_GUIDE.md       # This operational integration guide
│   ├── SECURITY.md               # Security policy & CyberArk governance
│   └── images/                   # Architecture diagrams
├── frontend/                     # React 19 + Vite dashboard (compiles to dist/)
├── logger/                       # Winston centralized logging
├── logs_collection/              # Fluentd, Splunk & Elasticsearch collectors
├── metrics_collection/           # Prometheus, Dynatrace & OTel collectors
├── remediation/                  # Autonomous remediation & runbooks
├── scripts/                      # Build, verification, and linting scripts
├── shared/                       # Shared error classes & severity constants
├── tests/                        # 12 automated end-to-end and schema test suites
├── package.json                  # Root npm configuration ("main": "backend/server.js")
├── README.md                     # Root README linking to docs/
├── start.bat                     # Windows deployment start script
└── web.config                    # Windows IIS deployment configuration
```

---

## 3. Step-by-Step Production Integration Blueprint

### Step 1: Configuration Management (`config/global.yaml` & `config/apps/*.yaml`)

**File Path:** [`config/global.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/config/global.yaml)  
**Purpose:** Master declarative configuration. Zero endpoint URLs are hardcoded in application logic; all modules read from this file.

| Setting / Section | Required Production Value / Action |
| :--- | :--- |
| `environment:` | Set to `"production"`. Ensures default boot state is PROD. |
| `telemetry_provider:` | Set to `"opentelemetry"`. Activates Profile 1 (OpenTelemetry + Sentinel Prober). |
| `prod_urls.app_url`<br>`prod_urls.avi_virtual_service_url` | Set to your enterprise corporate RefWeb URL (e.g. `https://sentinel.yourbank.internal`) and AVI Virtual Service VIP. |
| Application API URLs<br>(`bitbucket_api`, `artifactory_api`, `jenkins_master_url`, `argocd_api`, etc.) | Update with internal enterprise production DNS endpoints (e.g. `https://bitbucket.prod.corp/rest/api/1.0`). |
| `prod_urls.nas_mount` | Set to the production UNC share path where log archives reside (e.g. `d:\production_shares\nas_logs` or `\\corp.internal\shares\sentinel_logs`). |
| `prod_urls.db_jdbc` | Update PostgreSQL JDBC connection string: `jdbc:postgresql://<PROD_PG_HOST>:5432/<DB_NAME>`. |
| `sso_ldap_config:` | Set `enabled: true`. Provide internal Active Directory / eLDAP `ldap_url` (`ldaps://...:636`), `base_dn`, and `bind_dn`. |
| `collectors:` | Master toggles:<br>• `dynatrace.enabled: false` (Default in Profile 1; set `true` if syncing Dynatrace v2).<br>• `python_metrics.enabled: true` (Set `false` if Python/Selenium is not installed). |
| `components_enabled:` | Granular infrastructure toggles. Enable only active, provisioned infrastructure components (`avi_load_balancer`, `database`, `nas_performance`, etc.). |
| `applications_enabled:` | Granular DevOps toolchain toggles. Set `false` for any application not yet provisioned to cleanly skip network calls without throwing errors. |

#### Application Topologies (`config/apps/*.yaml`):
Each toolchain member has its dedicated YAML declaration in `config/apps/` (e.g., `bitbucket.yaml`, `jenkins.yaml`, `artifactory.yaml`, `argocd.yaml`). Configure tier levels, health endpoints, and thresholds per application.

---

### Step 2: CyberArk Vault Integration (`config/cyberark.yaml`)

**File Path:** [`config/cyberark.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/config/cyberark.yaml)  
**Implementation File:** [`backend/config/cyberark/credential_provider.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/backend/config/cyberark/credential_provider.js)  
**Purpose:** Maps functional credential requests to CyberArk Central Credential Provider (CCP) Safes and Objects. **Never commit actual passwords or tokens to source code.**

| Registry Key | Production Action |
| :--- | :--- |
| `applications.bitbucket` | Map `safe:` to your production Safe (e.g. `SF-BITBUCKET-PROD`) and `objects.api_token` to the CyberArk Account Object name storing the Bitbucket Personal Access Token (PAT). |
| `applications.jfrog_artifactory` | Map Artifactory Safe and API token Account Object. |
| `applications.cloudbees_jenkins` | Map Jenkins Safe and `remediation_token` Account Object for dispatching self-healing jobs. |
| `applications.argocd` | Map ArgoCD API Token Account Object. |
| `getCredential(appId, purpose)` | Queries CyberArk CCP HTTP endpoint: `GET /AIMWebService/api/Accounts?AppID=...&Safe=...&Object=...`. Cached in-memory for sub-5ms lookups. |
| Fallback Protocol | If CyberArk CCP is temporarily unreachable, checks environment variable overrides (`BITBUCKET_API_TOKEN`, `PGPASSWORD`, `DYNATRACE_API_TOKEN`) before logging `WARN`. |

#### JWT Signing Secret Rotation Protocol (`SENTINEL_JWT_SECRET`)
To rotate an exposed or scheduled JWT signing secret:
1. **Generate a New Cryptographic Secret**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
2. **Update Enterprise Deployment Secret Store**:
   - **Windows Server (IIS / Machine Env)**:
     ```powershell
     [Environment]::SetEnvironmentVariable('SENTINEL_JWT_SECRET', '<NEW_SECRET>', 'Machine')
     ```
   - **Linux / systemd**:
     ```bash
     systemctl edit sentinel-api --drop-in=secrets.conf
     # Add: Environment="SENTINEL_JWT_SECRET=<NEW_SECRET>"
     systemctl daemon-reload && systemctl restart sentinel-api
     ```
   - **Local / Staging**: Update `.env` (confirming `.env` remains in `.gitignore`).
3. **Restart API Services**: Perform rolling restart of Node processes to invalidate active tokens and enforce fresh eLDAP authentication.

---

### Step 3: PostgreSQL / TimescaleDB Setup (`database/postgres.js`)

**File Path:** [`database/postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/database/postgres.js)  
**Purpose:** Production persistent time-series datastore.

#### Code Capabilities:
* **`getPool()`**: Initializes `pg.Pool` using credentials resolved from `db_jdbc` and CyberArk (`credentialProvider.getCredential('database', 'db')`). Configured with `max: 20` client connections, 30s idle timeout, and 5s connection timeout.
* **`saveMetricBatchToPostgres()`**: Multi-row batch insert. Buffers incoming metric arrays into a single parameterized SQL statement `INSERT INTO metrics(timestamp, component, metric_name, value) VALUES ...` to minimize round-trips and transaction overhead.
* **`fetchHistoricalMetricsFromPostgres()`**: Queries historical time-series data for dashboard sparklines. In `prod` or `staging` without historical telemetry, strictly returns `[]` (`Value Not Available`), preventing simulated mock curves from displaying.

#### Production PostgreSQL / TimescaleDB DDL:
Execute the following DDL on your production PostgreSQL/TimescaleDB database:

```sql
-- 1. Create Core Metrics Time-Series Table
CREATE TABLE IF NOT EXISTS metrics (
    timestamp   TIMESTAMPTZ NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'prod',
    component   VARCHAR(100) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    tags        JSONB DEFAULT '{}'
);

-- 2. Convert to TimescaleDB Hypertable (7-Day Partition Chunks)
SELECT create_hypertable('metrics', 'timestamp', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- 3. Enable Native Columnar Compression (Compresses chunks older than 7 days by 90-95%)
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'environment, component, metric_name'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days');

-- 4. Fast Range-Scan Indexes
CREATE INDEX IF NOT EXISTS idx_metrics_query 
ON metrics (environment, component, metric_name, timestamp DESC);

-- 5. Automated Retention Policy (Drops raw 10-second data after 60 days)
SELECT add_retention_policy('metrics', INTERVAL '60 days');
```

---

### Step 4: OpenTelemetry Fleet Ingestion (`POST /v1/metrics` & Normalizer)

**Ingest Route:** [`backend/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/backend/server.js)  
**Normalizer File:** [`metrics_collection/real/opentelemetry/otlp_metric_normalizer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/metrics_collection/real/opentelemetry/otlp_metric_normalizer.js)  
**Purpose:** Sentinel acts as an OpenTelemetry OTLP/HTTP metric ingestion receiver.

```text
┌─────────────────────────┐        OTLP/HTTP (POST)       ┌──────────────────────────────────┐
│ OpenTelemetry Collector │ ────────────────────────────> │ Sentinel API: POST /v1/metrics   │
│ (2,000+ Host Fleet)     │   https://<HOST>/v1/metrics   │ Rate Limiter: 1,000 req/min/IP   │
└─────────────────────────┘                               └────────────────┬─────────────────┘
                                                                           │
                                                                           ▼
                                                          ┌──────────────────────────────────┐
                                                          │ otlp_metric_normalizer.js        │
                                                          │ normalizeOtlpPayload()           │
                                                          └────────────────┬─────────────────┘
                                                                           │
                                      ┌────────────────────────────────────┴────────────────────────────────────┐
                                      ▼                                                                         ▼
                      ┌───────────────────────────────┐                                         ┌───────────────────────────────┐
                      │ db.js / Write-Behind Buffer   │                                         │ WebSocket Broadcast (/ws)     │
                      │ (Persist to TimescaleDB)      │                                         │ (Real-Time Live UI Update)    │
                      └───────────────────────────────┘                                         └───────────────────────────────┘
```

#### OTel Collector Agent Configuration (Deployed on host nodes):
Configure your host OpenTelemetry collector (`otel-collector-config.yaml`):

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:

processors:
  batch:
    timeout: 5s
    send_batch_size: 256

exporters:
  otlphttp:
    endpoint: "https://<YOUR-SENTINEL-APP-URL>/v1/metrics"
    headers:
      Authorization: "Bearer <YOUR_SENTINEL_SERVICE_TOKEN>"

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [batch]
      exporters: [otlphttp]
```

Semantic mappings:
* `system.cpu.utilization` / `host.cpu.usage` → `cpu` (0–100%)
* `system.memory.usage` / `host.memory.usage` → `memory` (MB)
* `jvm.memory.used` / `jvm.memory.heap.used` → `jvm_heap_used_mb`
* `system.filesystem.utilization` → `disk` (%)

---

### Step 5: Telemetry Collection & Standalone Dynatrace Integration

**Coordinator:** [`metrics_collection/collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/metrics_collection/collector_coordinator.js)  
**Strategy Selector:** [`metrics_collection/telemetry_provider_selector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/metrics_collection/telemetry_provider_selector.js)  
**Dynatrace Collector:** [`metrics_collection/real/dynatrace/dynatrace_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/metrics_collection/real/dynatrace/dynatrace_collector.js)

#### Tiered Polling Cadence:
* **Tier 1 (Every 10s)**: High-priority application health endpoints, Dynatrace active problems feed, Fluentd log stream anomaly check.
* **Tier 2 (Every 30s)**: Compute metrics, AVI load balancer state, PostgreSQL connection pool metrics.
* **Tier 3 (Every 120s)**: Deep infrastructure storage (NAS IOPS, S3 bucket latency, Kubernetes and Docker daemon probes).

---

### Step 6: Log Streaming & AI Anomaly Detection

**Log Collector:** [`logs_collection/real/fluentd/fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/logs_collection/real/fluentd/fluentd_log_collector.js)  
**AI Engine:** [`ai_analysis/real_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/ai_analysis/real_analyzer.js)  
**Remediation:** [`remediation/recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/remediation/recovery.js)

#### Workflow:
1. **Fluentd Shipping**: Consolidated streams written to `prod_urls.nas_mount` (e.g. `d:\production_shares\nas_logs\fluentd.log`).
2. **AI Regex Classifier**: Scans log lines for failure signatures (`OutOfMemoryError`, `Connection refused`, `No space left on device`, `Lock wait timeout`).
3. **Four-Eyes Dual Approval**:
   - `autonomousMode = true`: Auto-dispatches Jenkins remediation webhook.
   - `autonomousMode = false`: Requires 2 independent operators to authorize recovery actions before execution.

---

### Step 7: Windows Server IIS & AVI Load Balancer Deployment

#### A. Pre-requisites Installation:
1. Install Node.js LTS (v20+ or v24+).
2. Install IIS with `HTTP Platform Handler` (or `URL Rewrite` + `Application Request Routing`).
3. Build the frontend production bundle:
   ```powershell
   npm run build
   ```

#### B. Windows IIS Configuration ([`web.config`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/web.config)):
```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="httpplatformhandler" path="*" verb="*" modules="httpPlatformHandler" resourceType="Unspecified" />
    </handlers>
    <httpPlatform processPath="node.exe"
                  arguments="backend\server.js"
                  stdoutLogEnabled="true"
                  stdoutLogFile=".\logs\node.log"
                  startupTimeLimit="60">
      <environmentVariables>
        <environmentVariable name="PORT" value="%HTTP_PLATFORM_PORT%" />
        <environmentVariable name="NODE_ENV" value="production" />
      </environmentVariables>
    </httpPlatform>
    <webSocket enabled="true" pingInterval="00:00:30" />
  </system.webServer>
</configuration>
```

#### C. Manual or Scripted Startup:
- Start via batch runner:
  ```powershell
  .\start.bat
  ```
- Or run directly:
  ```powershell
  npm start
  ```

#### D. AVI Virtual Service Health Monitor:
| Health Monitor Parameter | Production Configuration |
| :--- | :--- |
| **Monitor Type** | HTTPS (or HTTP if SSL is terminated at AVI) |
| **Request Method** | `GET` |
| **Request Path** | `/healthz` (or `/api/healthz`, `/readyz`, `/status`) |
| **Expected Response Code**| `200` |
| **Expected Response Body**| `"status":"ok"` or `"status":"UP"` |
| **Probe Interval** | `15 seconds` |
| **Probe Timeout** | `5 seconds` |
| **Max Failed Attempts** | `2 consecutive failures to mark DOWN` |

---

## 4. Master Verification & Regression Protocol

Before signing off on production deployment, execute the full automated validation protocol:

```powershell
# 1. Compile and bundle frontend assets
npm run build

# 2. Run shared constants lint check
npm run lint:constants

# 3. Execute Complete Automated Regression Suite (12 Test Suites)
npm test

# 4. Execute Live Endpoint Verification against running server
node scripts/verify_all_endpoints.js
```

### Expected Results:
* `npm test`: **All 12 QA & test suites passed cleanly with 100% pass rate (0 failures).**
* `node scripts/verify_all_endpoints.js`: **All 22 live REST/SPA routes return HTTP 200 / strict JSON 404.**
