# 🚀 Comprehensive Production Integration & Deployment Plan

This document serves as the **master reference blueprint** for deploying the **Intelligent Observability and Autonomous Recovery Framework** into Tier-1 Production environments (MNC Banking Standard).

---

## 1. ⚙️ Fast Production Activation Toggle

To activate real live HTTP collectors and production database queries:
1. Copy [`.env.example`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/.env.example) to `.env` or set environment variables in your Kubernetes / SystemD deployment.
2. Set `USE_SIMULATED_COLLECTORS=false` (or set `USE_SIMULATED_COLLECTORS: false` inside [`config/config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/config/config.js)).
3. Execute the automated QA test suite: `npm test`.

---

## 2. 🗄️ Database Setup Schemas

### A. PostgreSQL / TimescaleDB Setup (Metrics Table)
Execute the following SQL script on your PostgreSQL instance to create time-partitioned hypertables for historical metrics:

```sql
-- 1. Create base metrics table
CREATE TABLE IF NOT EXISTS metrics (
    timestamp TIMESTAMPTZ NOT NULL,
    component VARCHAR(100) NOT NULL,    -- e.g., 'bitbucket', 'database', 'sso_gateway'
    metric_name VARCHAR(100) NOT NULL,  -- e.g., 'cpu_usage', 'memory_usage', 'active_connections'
    value DOUBLE PRECISION NOT NULL
);

-- 2. Convert into TimescaleDB hypertable (partitioned by 7-day intervals)
SELECT create_hypertable('metrics', 'timestamp', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- 3. Create index for fast historical trend lookups
CREATE INDEX IF NOT EXISTS idx_metrics_query ON metrics (component, metric_name, timestamp DESC);
```

### B. Snowflake Data Warehouse Setup (Log Analytics Table)
Execute the following SQL script on your Snowflake warehouse instance:

```sql
CREATE TABLE IF NOT EXISTS LOG_ANALYTICS (
    TIMESTAMP TIMESTAMP_NTZ NOT NULL,
    COMPONENT VARCHAR(100) NOT NULL,
    LOG_LEVEL VARCHAR(20) NOT NULL,    -- 'INFO', 'WARN', 'ERROR'
    MESSAGE TEXT,
    ENVIRONMENT VARCHAR(50) DEFAULT 'PROD'
);

CREATE INDEX IF NOT EXISTS IDX_LOG_ANALYTICS ON LOG_ANALYTICS (COMPONENT, TIMESTAMP DESC);
```

---

## 3. 🗺️ One-Stop Vendor Application & Infrastructure Reference Map

| Component Category | Application Name | Source Code Collector File Path | config/config.js Variable | Env Variable Override | Description & Configuration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Telemetry DB** | TimescaleDB / Postgres | [`database/postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/database/postgres.js) | `db_jdbc` | `PROD_DB_JDBC` | PostgreSQL JDBC connection URL. Credentials read from `PGUSER` and `PGPASSWORD`. |
| **Bitbucket** | Atlassian Bitbucket | [`metrics_collection/real/applications/bitbucket_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/bitbucket_collector.js) | `bitbucket_api` | `PROD_BITBUCKET_API` | REST base URL. Authenticates via Bearer Personal Access Token (PAT). |
| **Artifactory** | JFrog Artifactory | [`metrics_collection/real/applications/artifactory_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/artifactory_collector.js) | `artifactory_api` | `PROD_ARTIFACTORY_API` | Queries system/storage stats and system ping latencies. |
| **Fortify SSC** | OpenText Fortify SSC | [`metrics_collection/real/applications/fortify_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/fortify_collector.js) | `fortify_api` | `PROD_FORTIFY_API` | Synchronizes static security review queue status. |
| **NexusIQ** | Sonatype NexusIQ | [`metrics_collection/real/applications/nexusiq_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/nexusiq_collector.js) | `nexusiq_api` | `PROD_NEXUSIQ_API` | Scans vulnerability metrics and policy violations. |
| **SonarQube** | SonarQube Enterprise | [`metrics_collection/real/applications/sonarqube_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/sonarqube_collector.js) | `sonarqube_api` | `PROD_SONARQUBE_API` | Inspects quality gates status and scanner queues. |
| **Jenkins Master** | CloudBees Jenkins CI | [`metrics_collection/real/applications/jenkins_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/jenkins_collector.js) | `jenkins_master_url` | `PROD_JENKINS_MASTER_URL` | Pulls build executor usage states and task queue delays. |
| **TeamCity** | JetBrains TeamCity | [`metrics_collection/real/applications/teamcity_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/teamcity_collector.js) | `teamcity_api` | `PROD_TEAMCITY_API` | Inspects active agent workloads and pool ratios. |
| **ArgoCD** | ArgoCD Hub | [`metrics_collection/real/applications/argocd_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/argocd_collector.js) | `argocd_api` | `PROD_ARGOCD_API` | Queries Git repository synchronization status mapping. |
| **Argo Workflows** | Argo Workflows | [`metrics_collection/real/applications/argoworkflows_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/argoworkflows_collector.js) | `argoworkflows_api` | `PROD_ARGOWORKFLOWS_API` | Monitors batch pipeline status and completion counts. |
| **GitHub** | GitHub Enterprise | [`metrics_collection/real/applications/github_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/github_collector.js) | `github` | `PROD_GITHUB_API` | Monitors repo pool status and Actions runner usage. |
| **Bitbucket Ext** | Bitbucket External | [`metrics_collection/real/applications/bitbucket_external_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/bitbucket_external_collector.js) | `bitbucket_external_api` | `PROD_BITBUCKET_EXTERNAL_API` | External Bitbucket REST base URL for cross-org repos. |
| **OTKR** | OTKR Security Engine | [`metrics_collection/real/applications/otkr_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/otkr_collector.js) | `otkr_api` | `PROD_OTKR_API` | Internal security scan tool REST API for auditing. |
| **Perf Center** | Performance Center | [`metrics_collection/real/applications/performance_center_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/applications/performance_center_collector.js) | `performance_center_api` | `PROD_PERFORMANCE_CENTER_API` | Performance testing platform API for load benchmarks. |
| **Avi Balancer** | AVI Load Balancer | [`metrics_collection/real/infrastructure/avi_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/infrastructure/avi_collector.js) | `avi_api` | `PROD_AVI_API` | Reads network flow, bandwidth load, and connection drops. |
| **SSO / LDAP** | SSO & eLDAP Gateway | [`metrics_collection/real/infrastructure/sso_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/infrastructure/sso_collector.js) | `sso_api` | `PROD_SSO_API` | Monitors credentials validation and LDAP sync response delay. |
| **NAS Share** | NAS Storage Share | [`metrics_collection/real/infrastructure/nas_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/infrastructure/nas_collector.js) | `nas_mount` | `PROD_NAS_MOUNT` | UNC path to write/archive aggregated logs. |
| **Windows Hosts** | Windows Host Cluster | [`metrics_collection/real/infrastructure/windows_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/infrastructure/windows_collector.js) | `windows_api` | `PROD_WINDOWS_API` | Queries Windows servers for CPU, RAM, and Disk metrics. |
| **Linux Hosts** | Linux Host Clusters | [`metrics_collection/real/infrastructure/linux_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/metrics_collection/real/infrastructure/linux_collector.js) | `unix_api / linux_api` | `PROD_UNIX_API` | Queries Linux cluster VMs for system load factors. |

---

## 🛠️ Step-by-Step Production Deployment Procedure

1. **Database Provisioning**: Run the PostgreSQL & Snowflake SQL scripts above to create tables and indexes.
2. **Environment Variable Configuration**: Create `.env` from [`.env.example`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/.env.example) and set secrets (`PGUSER`, `PGPASSWORD`, `PROD_DB_JDBC`, `USE_SIMULATED_COLLECTORS=false`).
3. **Execute QA Test Suite**: Run `npm test` to verify all 5 automated system assurance checks pass.
4. **Build Production Assets**: Run `npm run build-frontend` to compile optimized client static bundles.
5. **Launch Application**:
   - On Windows: Run `npm start` or execute `start.bat`
   - On Linux: Run `npm start` or execute `./start.sh`
6. **Verify Four-Eyes Governance**: Open [Admin Management](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Windows-Deploy/frontend/src/components/AdminManagement.jsx) to confirm RBAC roles and dual approval requirements.

---

## 4. 📦 Sample Custom Application Onboarding (`testdemoapp.yaml`)

This sample reference implementation demonstrates how to onboard a new microservice/application (`testdemoapp`) into the Intelligent Observability & Autonomous Recovery Framework.

### Step 1: Create Declarative Application YAML Configuration
Create [`config/applications/testdemoapp.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/applications/testdemoapp.yaml):

```yaml
id: "testdemoapp"
display_name: "Test Demo Application"
category: "custom_microservice"
log_tag: "[TEST-DEMO-APP]"

endpoints:
  prod:
    api: "https://testdemoapp-prod.internal.corp/api/v1"
  stg:
    api: "https://testdemoapp-stg.internal.corp/api/v1"

layers:
  avi_api: "https://avi-prod-testdemoapp.internal.corp/api/v1/telemetry"
  db_jdbc: "jdbc:postgresql://db-prod-testdemoapp.internal.corp:5432/testdemoapp_db"
  nas_mount: "d:\\production_shares\\nas_logs\\testdemoapp"
  s3_endpoint: "https://s3.prod-testdemoapp-us-east-1.amazonaws.com"
  sso_api: "https://sso-auth-prod-testdemoapp.internal.corp/oauth2/token"
  network_latency_hosts:
    - "testdemoapp-prod.internal.corp"

servers:
  - node: "testdemoapp-node-1"
    type: "linux"
    api: "https://linux-compute-prod-testdemoapp-1.internal.corp/api/v1/metrics"

metrics_baseline:
  activeBuilds: 5
  agents: 8
  load: 30.0

jenkins_remediation_job: "JOB_RESTART_TESTDEMOAPP_SERVICE"
```

### Step 2: Create Custom Application Metrics Collector
Create [`metrics_collection/simulation/applications/testdemoapp_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/simulation/applications):

```javascript
function collect(simulations, baseMetrics) {
  const isOutage = simulations.testdemoapp && simulations.testdemoapp.type === 'outage';

  return {
    activeBuilds: isOutage ? 0 : Math.floor((baseMetrics.activeBuilds || 5) + (Math.random() * 2 - 1)),
    agents: baseMetrics.agents || 8,
    load: isOutage ? 99.9 : parseFloat(((baseMetrics.load || 30) + (Math.random() * 4 - 2)).toFixed(2))
  };
}

module.exports = { collect };
```

### Step 3: Register Log Simulation Templates
In [`logs_collection/simulation/fluentd/fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection/simulation/fluentd/fluentd_log_collector.js):

- Add standard log stream entry to `normalLogs`:
  `"[TESTDEMOAPP] Processed request on /api/v1/demo - Status 200 OK (elapsed: 18ms)"`

- Add error templates to `errorLogs.testdemoapp`:
  ```javascript
  errorLogs.testdemoapp = [
    "[TESTDEMOAPP-FATAL] java.lang.OutOfMemoryError: Container memory limit exceeded on node-1.",
    "[TESTDEMOAPP-CRASH] Application service crashed with exit code 137."
  ];
  ```

### Step 4: Configure AI Anomaly Detection Signature
In [`ai_analysis/simulation_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/simulation_analyzer.js):

Append rule to `ANOMALY_PATTERNS`:
```javascript
{
  regex: /TESTDEMOAPP-FATAL|Container memory limit exceeded/i,
  category: 'TestDemoApp Memory Anomaly',
  component: 'testdemoapp',
  jenkinsJob: 'JOB_RESTART_TESTDEMOAPP_SERVICE',
  severity: 'Critical',
  message: 'Local AI Anomaly: Detected memory limit exhaustion in testdemoapp logs.'
}
```

### Step 5: Register Autonomous Self-Healing Workflow
In [`remediation/recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/recovery.js):

- Add workflow definition to `workflows`:
  ```javascript
  testdemoapp: {
    actionName: 'Restart Test Demo App Service and recycle JVM pool',
    steps: [
      'Analyzing container crash logs for testdemoapp...',
      'Restarting testdemoapp service instances...',
      'Verifying health check http://testdemoapp-prod.internal.corp/api/v1... HTTP 200 OK',
      'Incident resolved and Dynatrace status updated.'
    ]
  }
  ```

- Map Jenkins Job inside `executeRecoveryWorkflow`:
  ```javascript
  if (component === 'testdemoapp') jobName = 'JOB_RESTART_TESTDEMOAPP_SERVICE';
  ```

### Step 6: Verify Dynamic UI & API Auto-Discovery
Once the YAML configuration is placed in `config/applications/testdemoapp.yaml`:
1. **Backend Integration**: [`backend/server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js) dynamically loads all YAML applications via `yamlConfig.loadAllApplications()` and incorporates `testdemoapp` into the system health matrix score and component status map.
2. **GitOps UI Integration**: [`frontend/src/components/YamlConfigManager.jsx`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/components/YamlConfigManager.jsx) automatically lists `testdemoapp.yaml` under application declarations and enables GitOps Bitbucket Pull Request creation for config changes.
