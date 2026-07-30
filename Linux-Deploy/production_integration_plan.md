# Production Integration Plan: One-Stop Enterprise Telemetry Registry

This document serves as the absolute, one-stop reference blueprint for migrating the Intelligent Observability Framework from simulated baselines to real production endpoints. 

To enable live collection and datastore queries:
1. Set `USE_SIMULATED_COLLECTORS: false` inside [`config/config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/config/config.js) (Line 9).
2. Use the map below to configure the target database schema, system endpoints, and connection secrets.

---

## 🗄️ Database Setup Schema (TimescaleDB / PostgreSQL)
Before activating live collection, execute the following script on your target PostgreSQL instance to enable time-partitioned hypertables for historical metrics:

```sql
-- 1. Create the base metrics table
CREATE TABLE metrics (
    timestamp TIMESTAMPTZ NOT NULL,
    component VARCHAR(100) NOT NULL, -- e.g., 'bitbucket', 'database', 'sso_gateway'
    metric_name VARCHAR(100) NOT NULL, -- e.g., 'cpu', 'latency_ms', 'connections'
    value DOUBLE PRECISION NOT NULL
);

-- 2. Convert table into a TimescaleDB hypertable partitioned by time (7-day intervals)
SELECT create_hypertable('metrics', 'timestamp', chunk_time_interval => INTERVAL '7 days');

-- 3. Create index for fast query lookups
CREATE INDEX idx_metrics_query ON metrics (component, metric_name, timestamp DESC);
```

---

## 🗺️ One-Stop Source Code Integration Reference Map

| Component Category | Source Code File Path | config/config.js Variable | PROD Line | STG Line | Config / Setup Description |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Telemetry Database** | [`database/postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/database/postgres.js) | `db_jdbc` | **Line 27** | **Line 138** | PostgreSQL JDBC connection URL. Username/Password read from OS Env (`PGUSER`/`PGPASSWORD`). |
| **Bitbucket** | [`metrics_collection/real/applications/bitbucket_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/bitbucket_collector.js) | `bitbucket_api` | **Line 13** | **Line 145** | REST base URL. Authenticates via Bearer Personal Access Token (PAT). |
| **Artifactory** | [`metrics_collection/real/applications/artifactory_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/artifactory_collector.js) | `artifactory_api` | **Line 14** | **Line 146** | Queries system/storage stats and system ping latencies. |
| **ArgoCD** | [`metrics_collection/real/applications/argocd_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/argocd_collector.js) | `argocd_api` | **Line 15** | **Line 150** | Queries Git repository synchronization status mapping. |
| **Argo Workflows** | [`metrics_collection/real/applications/argoworkflows_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/argoworkflows_collector.js) | `argoworkflows_api` | **Line 16** | **N/A** | Monitors batch pipeline status and completion counts. |
| **Jenkins Master** | [`metrics_collection/real/applications/jenkins_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/jenkins_collector.js) | `jenkins_master_url` | **Line 17** | **Line 162** | Pulls build executor usage states and task queue delays. |
| **TeamCity** | [`metrics_collection/real/applications/teamcity_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/teamcity_collector.js) | `teamcity_api` | **Line 18** | **Line 149** | Inspects active agent workloads and pool ratios. |
| **SonarQube** | [`metrics_collection/real/applications/sonarqube_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/sonarqube_collector.js) | `sonarqube_api` | **Line 19** | **N/A** | Inspects quality gates status and scanner queues. |
| **Nexus IQ** | [`metrics_collection/real/applications/nexusiq_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/nexusiq_collector.js) | `nexusiq_api` | **Line 20** | **Line 147** | Scans vulnerability metrics and policy violations. |
| **Fortify SSC** | [`metrics_collection/real/applications/fortify_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/applications/fortify_collector.js) | `fortify_api` | **Line 21** | **Line 148** | Synchronizes static security review queue status. |
| **Avi Load Balancer** | [`metrics_collection/real/infrastructure/avi_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/avi_collector.js) | `avi_api` | **Line 22** | **Line 137** | Reads network flow, bandwidth load, and connection drops. |
| **SSO / LDAP Auth** | [`metrics_collection/real/infrastructure/sso_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/sso_collector.js) | `sso_api` | **Line 23** | **N/A** | Monitors credentials validation and LDAP sync response delay. |
| **NAS File Share** | [`metrics_collection/real/infrastructure/nas_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/nas_collector.js) | `nas_mount` | **Line 24** | **Line 139** | Local or UNC path to write/archive aggregated application logs. |
| **Windows Compute** | [`metrics_collection/real/infrastructure/windows_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/windows_collector.js) | `windows_api` | **Line 25** | **Line 141** | Queries target Windows servers for CPU, RAM, and Disk space. |
| **Linux Compute** | [`metrics_collection/real/infrastructure/linux_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/linux_collector.js) | `unix_api / linux_api` | **Line 26** | **Line 140** | Queries target Linux cluster VMs for system load factors. |
| **Kubernetes API** | [`metrics_collection/real/infrastructure/k8s_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/k8s_collector.js) | `k8s_api` | **Line 28** | **N/A** | Connects using local Kubeconfig files or container roles. |
| **S3 Storage** | [`metrics_collection/real/infrastructure/s3_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/s3_collector.js) | `s3_endpoint` | **Line 34** | **Line 142** | Connects using standard AWS SDK to list bucket stats. |
| **ICMP Ping Targets**| [`metrics_collection/real/infrastructure/network_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/Linux-Deploy/metrics_collection/real/infrastructure/network_collector.js) | `network_latency_hosts` | **Lines 29-33** | **N/A** | Hostnames checked for raw network ping round-trip times. |

---

## 🛠️ Step-by-Step Production Verification

1. **Deploy Databases**: Run the SQL schema to initialize the TimescaleDB hypertable.
2. **Assign Credentials**: Set OS variables (`PGUSER`, `PGPASSWORD`) on the host system.
3. **Configure Targets**: Open [`config/config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/config/config.js), modify the lines mapped above, and set `USE_SIMULATED_COLLECTORS` to `false`.
4. **Launch Application**:
   - On Windows: Run `start.bat`
   - On Linux: Run `./start.sh`
5. **Monitor Logs**: Review the telemetry logs written to the path configured in `nas_mount`.
