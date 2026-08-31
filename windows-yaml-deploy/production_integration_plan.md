# 🚀 Production Integration & Deployment Plan

This document is the **master deployment blueprint** for the **Intelligent Observability and Autonomous Recovery Framework** on Windows Server with AVI Load Balancer and enterprise RefWeb URL exposure.

---

## 1. ⚙️ Pre-Deployment Checklist

| Step | Action | File / Location |
| :--- | :--- | :--- |
| ✅ 1 | Update production endpoints, AVI VS URL, and ordered app URL | [`config/global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml) → `prod_urls:` |
| ✅ 2 | Update eLDAP / Active Directory bind credentials | [`config/global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml) → `sso_ldap_config:` |
| ✅ 3 | Map CyberArk Safe names and Object IDs for all credentials | [`config/cyberark/registry.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/cyberark/registry.yaml) |
| ✅ 4 | Set runtime secrets in `.env` (copy from `.env.example`) | [`/.env.example`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/.env.example) |
| ✅ 5 | Run automated QA suite | `npm test` (11 suites) |
| ✅ 6 | Build optimized frontend bundle | `npm run build-frontend` |
| ✅ 7 | Start server | `npm start` or `start.bat` |
| ✅ 8 | Point AVI Health Monitor to `/api/healthz` (HTTP 200 = UP) | [`backend/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js) |

---

## 2. 🔑 Single Source of Truth: `config/global_config.yaml`

**All production URLs, AVI endpoints, and infrastructure settings live in one file.**
Update the `prod_urls` section with your ordered/assigned production values:

```yaml
# Environment Mode (also dynamically switchable via UI)
environment: "production"

prod_urls:
  app_url: "https://<YOUR-ORDERED-APP-URL>"              # Ordered RefWeb / public URL
  avi_virtual_service_url: "https://<YOUR-AVI-VS-URL>"   # Ordered AVI Virtual Service URL

  avi_api: "https://avi-prod.internal.corp/api/v1/telemetry"
  sso_api: "https://sso-auth-prod.internal.corp/oauth2/token"
  nas_mount: "d:\\production_shares\\nas_logs"
  windows_api: "https://win-compute-prod.internal.corp/api/v1/metrics"
  unix_api: "https://linux-compute-prod.internal.corp/api/v1/metrics"
  db_jdbc: "jdbc:postgresql://db-prod-primary.internal.corp:5432/telemetry_db"
  k8s_api: "https://k8s-apiserver-prod.internal.corp:6443"
  bitbucket_api: "https://bitbucket-prod.internal.corp/rest/api/1.0"
  artifactory_api: "https://artifactory-prod.internal.corp/artifactory/api"
  argocd_api: "https://argocd-prod.internal.corp/api/v1"
  argoworkflows_api: "https://argo-workflows-prod.internal.corp/api/v1"
  jenkins_master_url: "https://jenkins-prod.internal.corp/job"
  teamcity_api: "https://teamcity-prod.internal.corp/app/rest"
  sonarqube_api: "https://sonarqube-prod.internal.corp/api"
  nexusiq_api: "https://nexusiq-prod.internal.corp/api/v2"
  fortify_api: "https://fortify-prod.internal.corp/ssc/api/v1"
```

> **No other file needs editing for endpoint configuration.** The backend, all collectors, and the AVI health monitor all read from this single YAML at startup.

---

## 3. 🗄️ Database Setup Schemas

### A. PostgreSQL / TimescaleDB (Metrics Time-Series)

```sql
CREATE TABLE IF NOT EXISTS metrics (
    timestamp   TIMESTAMPTZ NOT NULL,
    component   VARCHAR(100) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    environment VARCHAR(20) DEFAULT 'prod'
);

-- Convert to TimescaleDB hypertable (7-day partitions)
SELECT create_hypertable('metrics', 'timestamp', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_query ON metrics (component, metric_name, environment, timestamp DESC);
```

### B. Snowflake Data Warehouse (Log Analytics)

```sql
CREATE TABLE IF NOT EXISTS LOG_ANALYTICS (
    TIMESTAMP   TIMESTAMP_NTZ NOT NULL,
    COMPONENT   VARCHAR(100) NOT NULL,
    LOG_LEVEL   VARCHAR(20) NOT NULL,
    MESSAGE     TEXT,
    ENVIRONMENT VARCHAR(50) DEFAULT 'PROD'
);

CREATE INDEX IF NOT EXISTS IDX_LOG_ANALYTICS ON LOG_ANALYTICS (COMPONENT, ENVIRONMENT, TIMESTAMP DESC);
```

---

## 4. 🌐 OpenTelemetry Collector Configuration

Project Sentinel acts as a **passive OTLP/HTTP receiver** on `POST /v1/metrics`.
Point your OTel Collector fleet at the application's ordered URL:

```yaml
# otel-collector-config.yaml (deploy on each Linux / Windows / K8s host)
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

The normalizer ([`metrics_collection/real/opentelemetry/otlp_metric_normalizer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/opentelemetry/otlp_metric_normalizer.js)) automatically maps standard OTel metric names (e.g. `system.cpu.utilization`, `jvm.memory.used`) to Sentinel dashboard keys.

---

## 5. 🖥️ Windows Server IIS Deployment (web.config)

The [`web.config`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/web.config) at the root is pre-configured for:
- **HttpPlatformHandler**: Routes all IIS traffic directly to `node.exe backend\server.js`.
- **IIS WebSocket Support**: Native 30-second ping interval.
- **IIS URL Compression**: Dynamic + static gzip compression.
- **Security Headers**: `X-Content-Type-Options`, `X-Frame-Options`.

No additional IIS configuration is needed beyond enabling the `HttpPlatformHandler` module.

---

## 6. 🏗️ AVI Load Balancer Health Monitor

Configure the AVI Virtual Service health monitor to probe:

| Setting | Value |
| :--- | :--- |
| **Protocol** | HTTPS |
| **Method** | GET |
| **Path** | `/api/healthz` |
| **Expected Response Code** | 200 |
| **Expected Response Body** | `"status":"UP"` |
| **Interval** | 15s |
| **Timeout** | 5s |

The server also responds to `/health`, `/status`, and `/api/ping` for compatibility with different health monitor configurations.

---

## 7. 🗺️ Vendor Application & Infrastructure Reference Map

| Component | Config YAML | YAML Key | Description |
| :--- | :--- | :--- | :--- |
| **TimescaleDB / Postgres** | `global_config.yaml` | `db_jdbc` | PostgreSQL JDBC connection. Credentials via `PGUSER` / `PGPASSWORD` env vars or CyberArk. |
| **Bitbucket** | `applications/bitbucket.yaml` | `endpoints.prod.api` | REST API base URL. Bearer PAT token via CyberArk. |
| **Artifactory** | `applications/artifactory.yaml` | `endpoints.prod.api` | JFrog system stats and storage API. |
| **Fortify SSC** | `applications/fortify.yaml` | `endpoints.prod.api` | Security review queue status. |
| **NexusIQ** | `applications/nexusiq.yaml` | `endpoints.prod.api` | Vulnerability policy violation metrics. |
| **SonarQube** | `applications/sonarqube.yaml` | `endpoints.prod.api` | Quality gate status and scanner queues. |
| **Jenkins** | `applications/jenkins_k8s.yaml` | `endpoints.prod.api` | Build executor usage and queue delays. |
| **TeamCity** | `applications/teamcity.yaml` | `endpoints.prod.api` | Agent workloads and pool ratios. |
| **ArgoCD** | `applications/argocd.yaml` | `endpoints.prod.api` | Git sync status and app health. |
| **Argo Workflows** | `applications/argoworkflows.yaml` | `endpoints.prod.api` | Batch pipeline status and completion counts. |
| **AVI Load Balancer** | `infrastructure/avi.yaml` | `endpoint` | Network flow, bandwidth, connection metrics. |
| **SSO / eLDAP** | `infrastructure/sso_eldap.yaml` | `endpoint` | LDAP sync response and bind validation. |
| **NAS Share** | `global_config.yaml` | `nas_mount` | UNC path for log archive. |
| **Windows Hosts** | `infrastructure/windows.yaml` | `endpoint` | CPU, RAM, disk metrics via API. |
| **Linux Hosts** | `infrastructure/unix.yaml` | `endpoint` | System load metrics via API. |

---

## 8. 📦 Onboarding a New Application

To register a new application, create a single declarative YAML in `config/applications/`:

```yaml
# config/applications/myapp.yaml
id: "myapp"
display_name: "My Application"
category: "custom_microservice"
log_tag: "[MYAPP]"

endpoints:
  prod:
    api: "https://myapp-prod.internal.corp/api/v1"
  stg:
    api: "https://myapp-stg.internal.corp/api/v1"

layers:
  avi_api: "https://avi-prod.internal.corp/api/v1/pools/myapp"
  db_jdbc: "jdbc:postgresql://db-prod-primary.internal.corp:5432/myapp_db"
  nas_mount: "d:\\production_shares\\nas_logs\\myapp"

servers:
  - hostname: "myapp-prod-01.internal.corp"
    type: "linux"

jenkins_remediation_job: "JOB_RESTART_MYAPP_SERVICE"
```

**That's all.** No backend, frontend, or collector code changes are required. The backend auto-discovers all YAML files under `config/applications/` on startup and integrates `myapp` into the health matrix, environment-segregated data store, and YAML Config Manager UI.

---

## 9. 🧪 QA Test Suite

Run `npm test` to execute all 11 automated assurance suites:

| Test | File | Coverage |
| :--- | :--- | :--- |
| CyberArk Credential Lookup | `cyberark_provider.test.js` | Safe/Object vault resolution |
| Auth Lockdown | `auth_lockdown.test.js` | JWT and role enforcement |
| Schema Validation | `schema_validation.test.js` | YAML / API schema integrity |
| Telemetry Selector | `telemetry_selector.test.js` | OTel / Dynatrace / Prometheus profile resolution |
| OTLP Normalizer | `otlp_normalizer.test.js` | OTel metric name → Sentinel key mapping |
| Datastore Migration | `datastore_migration.test.js` | JSON DB rolling cap enforcement |
| Misc Operations | `misc_operations.test.js` | Custom checks registry |
| Prod Data Availability | `prod_data_availability.test.js` | Prod/Staging data isolation |
| Environment Segregation | `data_availability_segregation.test.js` | Concurrent dual-environment collection |
| Load Test (200 Hosts) | `load_test_200.js` | 200-host fan-out concurrency sweep |
| E2E QA Suite | `e2e_qa_suite.test.js` | Full DB, API, recovery, chaos checks |
