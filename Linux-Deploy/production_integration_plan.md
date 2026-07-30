# Production Integration Plan: Enterprise Telemetry & SSO Connectors

This document provides a detailed blueprint, steps, code file paths, and exact configurations to transition the Intelligent Observability Framework from simulated baselines to real production endpoints.

---

## ⚙️ Unified Endpoint Configuration Directory
All endpoints, JDBC connection strings, credentials, and tokens are centralized in:
*   **Target File**: [`config/config.js`](file:///c:/Users/admin/project/Desktop/iosph2/config/config.js)
*   **Step**: Set `USE_SIMULATED_COLLECTORS: false` to redirect the framework's collector loop to live endpoints.
*   **Production Configurations**: Update connection secrets and URLs under the newly added `PROD_URLS` block.

---

## 🛠️ Application Layer Integration Blueprints

### 1. Bitbucket
*   **Target File**: [`metrics_collection/real/applications/bitbucket_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/bitbucket_collector.js)
*   **API Path**: `GET https://bitbucket-prod.internal.corp/rest/api/1.0/projects`
*   **Auth Schema**: Bearer Personal Access Token (PAT)
*   **Implementation Steps**:
    ```javascript
    const res = await fetch(`${config.PROD_URLS.bitbucket_api}/projects`, {
      headers: { 'Authorization': `Bearer ${config.PROD_URLS.bitbucket_token}` }
    });
    const data = await res.json();
    ```

### 2. Artifactory
*   **Target File**: [`metrics_collection/real/applications/artifactory_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/artifactory_collector.js)
*   **API Path**: `GET https://artifactory-prod.internal.corp/artifactory/api/system/storage`
*   **Auth Schema**: Basic Admin Auth / Token
*   **Implementation Steps**:
    *   Query the system storage state to get disk space and binary store metrics.
    *   Query `/api/system/ping` to record JVM response latency.

### 3. ArgoCD
*   **Target File**: [`metrics_collection/real/applications/argocd_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/argocd_collector.js)
*   **API Path**: `GET https://argocd-prod.internal.corp/api/v1/applications`
*   **Auth Schema**: JWT Bearer Token
*   **Implementation Steps**:
    *   Parse the sync status of all monitored target git repositories:
    ```javascript
    const appState = data.items.map(app => ({
      name: app.metadata.name,
      status: app.status.sync.status // e.g. "Synced", "OutOfSync"
    }));
    ```

### 4. ArgoWorkflows [NEW MODULE]
*   **Target File**: Create [`metrics_collection/real/applications/argoworkflows_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/argoworkflows_collector.js)
*   **API Path**: `GET https://argo-workflows.internal.corp/api/v1/workflows/{namespace}`
*   **Implementation Steps**:
    *   Verify the completion state of batch pipeline runs.
    *   Count running, succeeded, or failed workflows in the target namespace.

### 5. Jenkins Master & CJOC
*   **Target File**: [`metrics_collection/real/applications/jenkins_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/jenkins_collector.js)
*   **API Path**: `GET https://jenkins-prod.internal.corp/api/json?tree=executors[idle,currentExecutable],queue[items[id]]`
*   **Implementation Steps**:
    *   Query build executor status and queue size.
    *   Trigger self-healing POST requests via [`remediation/real/jenkins/jenkins_trigger.js`](file:///c:/Users/admin/project/Desktop/iosph2/remediation/real/jenkins/jenkins_trigger.js) passing standard crumb tokens.

### 6. TeamCity
*   **Target File**: [`metrics_collection/real/applications/teamcity_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/teamcity_collector.js)
*   **API Path**: `GET https://teamcity-prod.internal.corp/app/rest/agents`
*   **Implementation Steps**:
    *   Validate build pool workloads and retrieve active running vs. idle agent ratios.

### 7. SonarQube [NEW MODULE]
*   **Target File**: Create [`metrics_collection/real/applications/sonarqube_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/sonarqube_collector.js)
*   **API Path**: `GET https://sonar.internal.corp/api/system/status`
*   **Implementation Steps**:
    *   Retrieve database connectivity health and verify quality gate scanner threads are operational.

### 8. NexusIQ
*   **Target File**: [`metrics_collection/real/applications/nexusiq_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/nexusiq_collector.js)
*   **API Path**: `GET https://nexus-iq-prod.internal.corp/api/v2/applications`
*   **Implementation Steps**:
    *   Collect vulnerability scanner job queue states and count unresolved policy violations.

### 9. Fortify SSC
*   **Target File**: [`metrics_collection/real/applications/fortify_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/applications/fortify_collector.js)
*   **API Path**: `GET https://fortify-ssc-prod.internal.corp/ssc/api/v1/projectVersions`
*   **Implementation Steps**:
    *   Synchronize security code review states and capture processing delays.

---

## 📡 Infrastructure Layer Integration Blueprints

### 10. AVI Endpoints & Load Balancers
*   **Target File**: [`metrics_collection/real/infrastructure/avi_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/avi_collector.js)
*   **API Path**: `GET https://avi-prod.internal.corp/api/v1/virtualservice-inventory`
*   **Implementation Steps**:
    *   Inspect ingress packet rates, connection volume, and throughput saturation to verify network metrics.

### 11. SSO Gateway & eLDAP
*   **Target File**: Create [`metrics_collection/real/infrastructure/sso_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/sso_collector.js)
*   **API Path**: Ping target LDAP portals or issue quick GET queries to authentication callback endpoints.
*   **Metric Captured**: Authentication latency (measured via precise stopwatch timers around network pings).

### 12. NAS storage performance
*   **Target File**: [`metrics_collection/real/infrastructure/nas_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/nas_collector.js)
*   **System Action**: Disk I/O scans.
*   **Implementation Steps**:
    *   For Windows Server paths, run native Node `fs` checks.
    *   For Linux mounts, execute `df -h` via SSH or parse the statistics inside `/proc/mounts`.

### 13. Windows Host Compute
*   **Target File**: [`metrics_collection/real/infrastructure/windows_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/windows_collector.js)
*   **Implementation Steps**:
    *   Execute command lines using `child_process.exec` to get WMI details:
    ```powershell
    wmic cpu get LoadPercentage /value
    wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value
    ```

### 14. Unix / Linux Host Compute
*   **Target File**: [`metrics_collection/real/infrastructure/linux_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/linux_collector.js)
*   **Implementation Steps**:
    *   Parse local compute states directly from `/proc/loadavg`, `/proc/meminfo`, and run commands such as:
    ```bash
    free -m | awk '/Mem:/ {print $3/$2 * 100}'
    ```

### 15. PostgreSQL / Snowflake Databases
*   **Target File**: [`database/db.js`](file:///c:/Users/admin/project/Desktop/iosph2/database/db.js)
*   **Query engine**: Use NPM client drivers `pg` (Postgres client pools) and `snowflake-sdk` (Snowflake database pools) to run query checks on the production servers.

### 16. Kubernetes Clusters (K8s)
*   **Target File**: Create [`metrics_collection/real/infrastructure/k8s_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/k8s_collector.js)
*   **Integration Library**: Use the official `@kubernetes/client-node` SDK to load configuration credentials locally from `~/.kube/config`.
*   **Implementation Steps**:
    *   Query namespaces and Pod states:
    ```javascript
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const pods = await k8sApi.listNamespacedPod('observability');
    ```

### 17. Network Latency & TCP Timings [NEW MODULE]
*   **Target File**: Create [`metrics_collection/real/infrastructure/network_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/network_collector.js)
*   **System Action**: Execute socket connection checks:
    ```javascript
    const net = require('net');
    const start = Date.now();
    const socket = net.createConnection(port, host, () => {
      const latency = Date.now() - start;
      socket.destroy();
    });
    ```

### 18. AWS S3 Buckets
*   **Target File**: [`metrics_collection/real/infrastructure/s3_collector.js`](file:///c:/Users/admin/project/Desktop/iosph2/metrics_collection/real/infrastructure/s3_collector.js)
*   **Integration Library**: Use `@aws-sdk/client-s3`.
*   **Implementation Steps**:
    *   Load credentials from environment profiles and issue `ListObjectsV2Command` queries to measure bucket sizes, upload speeds, and transaction response times.
