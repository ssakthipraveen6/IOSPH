# 📋 Project Sentinel — Production Readiness Jira Backlog (Comprehensive 27-Task Blueprint)

This document defines the complete enterprise Jira task backlog required for the production deployment and go-live certification of **Project Sentinel**. Each ticket includes standard Jira fields: **Issue Key**, **Type**, **Summary**, **Priority**, **Component**, **Estimate (Story Points)**, **Description**, and **Acceptance Criteria (Definition of Done)**.

---

## 📊 Executive Jira Epic & Issue Summary

| Issue Key | Type | Summary | Priority | Component | Points |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`SENT-EPIC-01`** | **Epic** | **Enterprise Infrastructure & Reverse Proxy Deployment** | Highest | `DevOps/Infra` | — |
| `SENT-101` | Task | Configure Windows Server IIS Reverse Proxy & URL Rewrite Rules | Highest | `DevOps/Infra` | 5 |
| `SENT-102` | Task | Provision AVI Vantage Virtual Service VIP, Health Probes & TLS Termination | Highest | `Network/LB` | 3 |
| `SENT-103` | Task | Restrict Intranet CORS Allowlist & Enterprise Ingress Firewall ACLs | High | `Security` | 2 |
| **`SENT-EPIC-02`** | **Epic** | **Enterprise Identity & Secrets Management Integration** | Highest | `Security` | — |
| `SENT-201` | Story | Provision CyberArk CCP Safes & Bind Service Account Tokens | Highest | `Security` | 5 |
| `SENT-202` | Story | Configure Corporate eLDAP / Active Directory Bindings & RBAC Mapping | High | `IAM` | 3 |
| `SENT-203` | Task | Establish Production JWT Key Vault Secret Storage & Rotation Procedure | High | `Security` | 2 |
| **`SENT-EPIC-03`** | **Epic** | **High-Availability Persistence & Time-Series Datastore** | High | `Database` | — |
| `SENT-301` | Task | Provision Production PostgreSQL / TimescaleDB Cluster & Initialize Schema DDL | High | `Database` | 5 |
| `SENT-302` | Task | Configure TimescaleDB 30-Day Hypertables & Multi-Row Batch Retention | High | `Database` | 3 |
| `SENT-303` | Task | Validate Local .runtime Cache Fallback & Write-Behind Resiliency | Medium | `Backend` | 3 |
| **`SENT-EPIC-04`** | **Epic** | **Telemetry Pipeline & Observability Profiles Rollout** | Highest | `Observability` | — |
| `SENT-401` | Story | Deploy OpenTelemetry Collector to Enterprise Linux Host Fleet (Ansible) | Highest | `Observability` | 5 |
| `SENT-402` | Story | Deploy OpenTelemetry Collector to Windows Server Fleet (PowerShell / SCCM) | Highest | `Observability` | 5 |
| `SENT-403` | Story | Deploy OpenTelemetry Collector DaemonSet to Kubernetes / OpenShift Clusters | High | `Observability` | 5 |
| `SENT-404` | Task | Configure Global Production Toolchain & Endpoint Toggles (`global_config.yaml`) | High | `Config` | 3 |
| `SENT-405` | Story | Authenticate & Activate Core Application Metric Collectors (Bitbucket, Jenkins, Artifactory, ArgoCD) | Highest | `Collectors` | 5 |
| `SENT-406` | Story | Authenticate & Activate Security Scanner Metric Collectors (SonarQube, Fortify, NexusIQ, OTKR) | High | `Collectors` | 5 |
| `SENT-407` | Story | Enable Infrastructure Telemetry Probes (AVI VIPs, Database TPS, NAS Mounts, eLDAP) | High | `Collectors` | 5 |
| `SENT-408` | Task | Setup Python Selenium Synthetic Journey Engine & Fluentd Log Forwarding | Medium | `Observability` | 3 |
| `SENT-409` | Task | Integrate Standalone Dynatrace API v2 Ingestion for Infrastructure Nodes | Medium | `Observability` | 5 |
| `SENT-410` | Task | Mount Enterprise NAS UNC Share & Verify Daily Rotating Log Compression | High | `Storage` | 3 |
| **`SENT-EPIC-05`** | **Epic** | **AI Anomaly Detection, RCA & ServiceNow ITSM Integration** | High | `AI/Analytics` | — |
| `SENT-501` | Story | Validate Real-Time Log Anomaly Regex Matchers against Live Production Streams | High | `AI/Analytics` | 5 |
| `SENT-502` | Story | Activate Linear Regression Predictive Forecasting for Capacity Exhaustion | High | `AI/Analytics` | 3 |
| `SENT-503` | Story | Connect ServiceNow REST API v2 for Active P1/P2/P3 Incident & CHG Correlation | High | `ITSM` | 5 |
| `SENT-504` | Task | Validate Config-Drift-to-RCA Causality Auditing in Production NOC Displays | Medium | `Frontend` | 3 |
| **`SENT-EPIC-06`** | **Epic** | **Autonomous SRE Remediation & Four-Eyes Governance** | High | `SRE` | — |
| `SENT-601` | Story | Establish Authenticated Webhook Triggers to Production Jenkins Self-Healing Jobs | High | `SRE` | 5 |
| `SENT-602` | Story | Validate Four-Eyes Dual-Administrator Approval State Machine for Critical Actions | High | `Security` | 3 |
| `SENT-603` | Task | Audit & Lock Down SRE Chaos Injection Controls in Production Build | Highest | `Security` | 2 |
| **`SENT-EPIC-07`** | **Epic** | **CI/CD Quality Gates & Release Verification** | High | `CI/CD` | — |
| `SENT-701` | Task | Activate Bitbucket Pipelines & GitHub Actions Dual-OS Matrix Builds | High | `CI/CD` | 3 |
| `SENT-702` | Task | Execute Pre-Go-Live User Acceptance Testing (UAT) & Failover Verification | Highest | `QA/NOC` | 5 |

---

## 📦 Detailed Jira Ticket Specifications

```
================================================================================
EPIC 1: ENTERPRISE INFRASTRUCTURE & REVERSE PROXY DEPLOYMENT
================================================================================
```

### `SENT-101` — Configure Windows Server IIS Reverse Proxy & URL Rewrite Rules
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-01`
* **Priority:** Highest (P1)
* **Component:** `DevOps/Infra`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Windows Systems Engineer / Platform SRE
* **Description:**
  Configure Windows Server (2019/2022) with Internet Information Services (IIS), Application Request Routing (ARR), and URL Rewrite 2.1 to act as the primary reverse proxy for Project Sentinel. The frontend static assets (`apps/web/dist`) must be served directly or routed cleanly, while backend API requests (`/api/*`, `/v1/metrics`, `/ws`) must be proxied to the local Node.js service running on port `3001` with WebSocket upgrade support.
* **Technical Implementation:**
  * File reference: `deployments/windows/web.config` and `deployments/windows/install_service.ps1`.
  * Enable IIS Application Request Routing: `system.webServer/proxy enabled="true"`.
  * Configure WebSocket proxying with `<webSocket enabled="true" />` to allow real-time telemetry streaming to the frontend.
  * Ensure gzip/deflate response compression headers pass through without truncation.
* **Acceptance Criteria (Definition of Done):**
  - [ ] IIS site configured with binding on port 80/443 pointing to corporate RefWeb hostname.
  - [ ] `GET /api/healthz` successfully proxies to `http://localhost:3001/api/healthz` returning HTTP 200.
  - [ ] WebSocket connections to `/ws` upgrade successfully without 1006 connection drops.
  - [ ] Node.js daemon registered as an automatic Windows Service via NSSM (`install_service.ps1`).

---

### `SENT-102` — Provision AVI Vantage Virtual Service VIP, Health Probes & TLS Termination
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-01`
* **Priority:** Highest (P1)
* **Component:** `Network/LB`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Network & Load Balancer Engineer
* **Description:**
  Provision the enterprise AVI Vantage Load Balancer Virtual Service (VIP) and Server Pool across all provisioned Sentinel backend application nodes. Configure TLS 1.3 / 1.2 termination with enterprise DigiCert CA certificates, and establish active health monitoring against the backend liveness probe.
* **Technical Implementation:**
  * File reference: `packages/config/global_config.yaml` (`prod_urls.avi_virtual_service_url`).
  * Configure AVI Virtual Service: `avi-vip-sentinel.yourbank.internal` (Dedicated IP).
  * Backend Server Pool: Add primary and standby Sentinel server IPs on port `3001` (or IIS port `443`).
  * Health Monitor: HTTP GET probe to `/api/healthz`, interval 5 seconds, timeout 2 seconds, 2 consecutive successes to mark healthy.
* **Acceptance Criteria (Definition of Done):**
  - [ ] AVI Virtual Service is green with 100% health score.
  - [ ] HTTP probe to `/api/healthz` validates server status and runtime environment.
  - [ ] TLS certificate is valid, matches domain SAN, and scores A+ on internal SSL audits.
  - [ ] Failover verified by stopping secondary node and confirming zero packet drop on active sessions.

---

### `SENT-103` — Restrict Intranet CORS Allowlist & Enterprise Ingress Firewall ACLs
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-01`
* **Priority:** High (P2)
* **Component:** `Security`
* **Estimate:** 2 Story Points
* **Assignee / Role:** Cyber Security Engineer
* **Description:**
  Enforce strict origin validation in `cors_validator.js` for production runtime. Only approved intranet domains, corporate RefWeb reverse proxies, and internal load balancers may execute cross-origin requests. Configure firewall ACLs to restrict port `3001` access solely to the reverse proxy and AVI VIP.
* **Technical Implementation:**
  * File reference: `apps/api/src/cors_validator.js` and `apps/api/src/server.js`.
  * Validate `ALLOWED_ORIGINS` environment variable in production `.env`.
  * Verify regex domain checks reject `.evilcorp.com` or spoofed subdomains while permitting `.internal`, `.corp`, and `.refweb.internal.corp`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Regression suite `tests/auth_lockdown.test.js` passes 100% green.
  - [ ] Requests originating from unapproved domains return `403 Forbidden` / CORS origin error.
  - [ ] Firewall ACL rule active: direct external access to port `3001` blocked; ingress permitted only via IIS/AVI.

---

```
================================================================================
EPIC 2: ENTERPRISE IDENTITY & SECRETS MANAGEMENT INTEGRATION
================================================================================
```

### `SENT-201` — Provision CyberArk CCP Safes & Bind Service Account Tokens
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-02`
* **Priority:** Highest (P1)
* **Component:** `Security`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Identity & Privileged Access Management (PAM) Engineer
* **Description:**
  As a Security Administrator, I need Project Sentinel to fetch all application credentials, API tokens, and database passwords dynamically from the CyberArk Central Credential Provider (CCP) over HTTPS without any hardcoded credentials in files or repository commits.
* **Technical Implementation:**
  * File reference: `packages/config/cyberark/registry.yaml` and `packages/config/cyberark/credential_provider.js`.
  * Provision CyberArk Safe: `PROD_SENTINEL_OBSERVABILITY_SAFE`.
  * Register Account Objects:
    * `Bitbucket_API_Token`
    * `Jenkins_Service_Account`
    * `Artifactory_Admin_Key`
    * `PostgreSQL_Production_User`
    * `Dynatrace_API_v2_Token`
  * Bind Sentinel's Application ID (`AppID=SENTINEL_PROD_APP`) with client certificate / IP authentication.
* **Acceptance Criteria (Definition of Done):**
  - [ ] `packages/config/cyberark/registry.yaml` mappings conform to enterprise naming standards.
  - [ ] In-memory TTL cache operates correctly (30-minute default) to prevent hammering the CCP vault.
  - [ ] Automated suite `tests/cyberark_provider.test.js` passes with zero credential leaks.
  - [ ] Fallback to `.env` works in isolated offline sandbox but throws critical error if vault is unreachable in PROD.

---

### `SENT-202` — Configure Corporate eLDAP / Active Directory Bindings & RBAC Mapping
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-02`
* **Priority:** High (P2)
* **Component:** `IAM`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Directory Services / IAM Engineer
* **Description:**
  As an SRE Lead, I need NOC operators and administrators to log into Project Sentinel using their corporate Active Directory credentials via secure LDAPS (`ldaps://...:636`) with role-based access control (Super Admin, Operator, Read Only).
* **Technical Implementation:**
  * File reference: `apps/api/src/auth/ldap_client.js` and `packages/config/global_config.yaml` (`sso_ldap_config`).
  * Configure LDAPS connection string, root certificate truststore, and service bind DN.
  * Map Active Directory Security Groups to Sentinel RBAC roles:
    * `CN=DevOps_NOC_Admins` $\rightarrow$ `Super Admin` (Full runbook execution & Four-Eyes sign-off).
    * `CN=DevOps_Engineers` $\rightarrow$ `Operator` (Runbook triggering & dashboard management).
    * `CN=DevOps_Viewers` $\rightarrow$ `Read Only` (Telemetry viewing only).
* **Acceptance Criteria (Definition of Done):**
  - [ ] Successful user login verified with corporate username and password.
  - [ ] Invalid password or disabled AD accounts correctly rejected with `401 Unauthorized`.
  - [ ] Role hierarchy verified: Read Only accounts cannot execute runbooks or modify YAML configs.
  - [ ] Audit log records every authentication attempt to `sentinel_audit.log` with timestamp and client IP.

---

### `SENT-203` — Establish Production JWT Key Vault Secret Storage & Rotation Procedure
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-02`
* **Priority:** High (P2)
* **Component:** `Security`
* **Estimate:** 2 Story Points
* **Assignee / Role:** Application Security Engineer
* **Description:**
  Establish a cryptographic JWT secret in the production environment (.env / CyberArk) using a 64-byte random hex string, ensuring the secret is never committed to Git and can be rotated without service downtime.
* **Technical Implementation:**
  * File reference: `apps/api/src/auth/session.js` and `PRODUCTION_GUIDE.md`.
  * Validate that `SENTINEL_JWT_SECRET` is populated from production environment variable or CyberArk.
  * Implement two-token rolling verification to allow session persistence during key rotation windows.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Verified `.env` and `*.env` are in `.gitignore` and absent from git history.
  - [ ] Test `tests/auth_lockdown.test.js` passes (rejects tampered or malformed JWT tokens).
  - [ ] Documented rotation procedure added to internal SRE Runbook vault.

---

```
================================================================================
EPIC 3: HIGH-AVAILABILITY PERSISTENCE & TIME-SERIES DATASTORE
================================================================================
```

### `SENT-301` — Provision Production PostgreSQL / TimescaleDB Cluster & Initialize Schema DDL
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-03`
* **Priority:** High (P2)
* **Component:** `Database`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Principal Database Administrator (DBA)
* **Description:**
  Provision an enterprise PostgreSQL 15+ cluster (or TimescaleDB) with automated replication, connection pooling (PgBouncer), and execute the master DDL script to create tables, indexes, and hypertable extensions for telemetry metrics and alerts.
* **Technical Implementation:**
  * File reference: `packages/database/postgres.js`.
  * Execute DDL:
    * `metrics_history` (timestamp, component, metric_name, value, unit, environment, tags).
    * `alerts_history` (timestamp, component, severity, message, status, environment).
    * `recovery_runs` (run_id, timestamp, component, action, initiated_by, status, environment).
  * Configure TimescaleDB extension: `SELECT create_hypertable('metrics_history', 'timestamp', if_not_exists => TRUE);`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] PostgreSQL cluster operational with primary and read-replica.
  - [ ] All tables, indexes, and constraints created without syntax warnings.
  - [ ] Connection pool (`pg.Pool`) configured with `max: 20`, idle timeout 30s.
  - [ ] Automated test `tests/datastore_migration.test.js` passes.

---

### `SENT-302` — Configure TimescaleDB 30-Day Hypertables & Multi-Row Batch Retention
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-03`
* **Priority:** High (P2)
* **Component:** `Database`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Database Administrator
* **Description:**
  Configure automated 30-day time-series data retention and compression policies on the `metrics_history` hypertable, and verify high-throughput multi-row batch insertion performance.
* **Technical Implementation:**
  * File reference: `packages/database/postgres.js` (`insertMetricBatch`).
  * Enable TimescaleDB compression policy: `SELECT add_compression_policy('metrics_history', INTERVAL '7 days');`.
  * Enable retention policy: `SELECT add_retention_policy('metrics_history', INTERVAL '30 days');`.
  * Verify parameterized multi-row batch insert syntax: `INSERT INTO metrics_history (...) VALUES ($1, $2, ...), ($8, $9, ...)`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Ingestion throughput benchmarked at > 5,000 metrics/sec without query latency degradation.
  - [ ] Automated chunk dropping verified for records older than 30 days.
  - [ ] Disk footprint reduced by > 60% via TimescaleDB columnar compression.

---

### `SENT-303` — Validate Local .runtime Cache Fallback & Write-Behind Resiliency
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-03`
* **Priority:** Medium (P3)
* **Component:** `Backend`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Backend Software Engineer
* **Description:**
  Validate the automatic failover to local write-behind storage (`.runtime/sentinel_db.json` and `.runtime/metrics_history.jsonl`) when the primary PostgreSQL cluster experiences network partition or transient downtime, ensuring zero data loss during failovers.
* **Technical Implementation:**
  * File reference: `packages/database/index.js` and `packages/database/postgres.js`.
  * Simulate database disconnect (`ENOTFOUND` or port block) during active collection.
  * Verify collector seamlessly diverts writes to `.runtime/metrics_history.jsonl`.
  * Verify API falls back to in-memory / `.runtime/sentinel_db.json` for dashboard queries.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Zero unhandled rejections or crashes during database network drop.
  - [ ] Dashboard continues rendering cached health matrix with clear status indicators.
  - [ ] Re-connection automatically resumes normal PostgreSQL querying.

---

```
================================================================================
EPIC 4: TELEMETRY PIPELINE & OBSERVABILITY PROFILES ROLLOUT
================================================================================
```

### `SENT-401` — Deploy OpenTelemetry Collector to Enterprise Linux Host Fleet (Ansible)
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** Highest (P1)
* **Component:** `Observability`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Linux Systems Administrator / SRE
* **Description:**
  Execute Ansible playbook across all target production Linux servers (hosting Bitbucket nodes, Jenkins runners, Artifactory VMs, PostgreSQL nodes) to install the approved `otelcol-contrib` RPM/DEB package, configure OTLP export, and register the systemd service.
* **Technical Implementation:**
  * File reference: `deployments/ansible/playbook_linux_otel.yml` and `deployments/opentelemetry_configs/otel_linux_config.yaml`.
  * Target hosts: Defined in `deployments/ansible/inventory.ini`.
  * Ansible execution command:
    ```bash
    ansible-playbook -i deployments/ansible/inventory.ini deployments/ansible/playbook_linux_otel.yml
    ```
  * Verify `otelcol-contrib` service starts on boot and streams `system.cpu.utilization`, `system.memory.utilization`, `system.disk.io`, and `process.*` metrics to `https://sentinel.yourbank.internal/v1/metrics`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Ansible playbook finishes with 0 failed tasks across 100% of target Linux hosts.
  - [ ] `systemctl status otelcol-contrib` is active (running) on all hosts.
  - [ ] Sentinel backend receives live OTLP push payloads via `POST /v1/metrics`.

---

### `SENT-402` — Deploy OpenTelemetry Collector to Windows Server Fleet (PowerShell / SCCM)
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** Highest (P1)
* **Component:** `Observability`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Windows Systems Engineer / SCCM Administrator
* **Description:**
  Deploy the OpenTelemetry Collector MSI package to all Windows Server application hosts (Fortify IIS nodes, TeamCity build agents, Windows build executors) via PowerShell / SCCM, deploying the configuration and starting the `otelcol` Windows Service.
* **Technical Implementation:**
  * File reference: `deployments/powershell/deploy_windows_otel.ps1` and `deployments/opentelemetry_configs/otel_windows_config.yaml`.
  * Silent MSI installation: `msiexec.exe /i otelcol-contrib.msi /qn /norestart`.
  * Target installation directory: `C:\Program Files\OpenTelemetry Collector\config.yaml`.
  * Windows Service registration: `Set-Service -Name "otelcol" -StartupType Automatic`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] PowerShell script runs silently without user intervention on Windows Server nodes.
  - [ ] Windows service `otelcol` is Running and configured for Automatic startup.
  - [ ] Sentinel backend receives live Windows memory, CPU, and disk I/O metrics.

---

### `SENT-403` — Deploy OpenTelemetry Collector DaemonSet to Kubernetes / OpenShift Clusters
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** High (P2)
* **Component:** `Observability`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Kubernetes Platform Engineer
* **Description:**
  Deploy the OpenTelemetry Collector DaemonSet into enterprise Kubernetes / OpenShift clusters supporting CloudBees Jenkins runners and ArgoCD, streaming pod resource quotas, container restart counts, and node utilization to Sentinel.
* **Technical Implementation:**
  * File reference: `deployments/k8s/otel_collector_daemonset.yaml`.
  * Namespace: `sentinel-monitoring`.
  * ServiceAccount, ClusterRole, and ClusterRoleBinding configured for cgroups and kubelet read access.
  * OTLP HTTP exporter pointing to `https://sentinel.yourbank.internal/v1/metrics`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] DaemonSet pods scheduled on 100% of cluster nodes.
  - [ ] Zero CrashLoopBackOff states in `sentinel-monitoring` namespace.
  - [ ] Sentinel backend normalizes container cgroups metrics via `otlp_metric_normalizer.js`.

---

### `SENT-404` — Configure Global Production Toolchain & Endpoint Toggles (`global_config.yaml`)
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** High (P2)
* **Component:** `Config`
* **Estimate:** 3 Story Points
* **Assignee / Role:** DevOps Engineer
* **Description:**
  Configure `packages/config/global_config.yaml` for production operation, establishing single-source-of-truth DNS endpoints, authentication parameters, and master component/application toggles.
* **Technical Implementation:**
  * File reference: `packages/config/global_config.yaml`.
  * Set `environment: "production"`.
  * Set `telemetry_provider: "opentelemetry"` (Profile 1).
  * Configure production URLs: `bitbucket_api`, `jenkins_master_url`, `artifactory_api`, `argocd_api`, `sonarqube_api`, `fortify_api`, `nexusiq_api`.
  * Adjust `applications_enabled` flags to reflect provisioned enterprise assets.
* **Acceptance Criteria (Definition of Done):**
  - [ ] `tests/schema_validation.test.js` passes all 6 validation assertions.
  - [ ] Zero development or mock URLs remaining in configuration.
  - [ ] Unmonitored or non-provisioned applications cleanly return `"Value Not Available"`.

---

### `SENT-405` — Authenticate & Activate Core Application Metric Collectors
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** Highest (P1)
* **Component:** `Collectors`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Platform SRE / Tools Lead
* **Description:**
  Authenticate and verify Sentinel's native Node.js application collectors for tier-1 CI/CD and repository platforms: Atlassian Bitbucket, CloudBees Jenkins, JFrog Artifactory, and ArgoCD.
* **Technical Implementation:**
  * File references:
    * `apps/collector/src/metrics_collection/real/applications/bitbucket_collector.js` (Git-pack thread latency, HTTP 504 rates).
    * `apps/collector/src/metrics_collection/real/applications/jenkins_collector.js` (Build queue depth, executor provisioning delays).
    * `apps/collector/src/metrics_collection/real/applications/artifactory_collector.js` (OldGen JVM heap %, binary upload latency).
    * `apps/collector/src/metrics_collection/real/applications/argocd_collector.js` (Cluster reconciliation sync latency).
  * Verify token resolution from CyberArk CCP without plain-text secret storage.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Bitbucket collector reports live TPS, latency, and node health.
  - [ ] Jenkins collector reports active build executors and queue counts.
  - [ ] Artifactory collector extracts storage pool utilization and JVM metrics.
  - [ ] ArgoCD collector reports application sync states across target clusters.

---

### `SENT-406` — Authenticate & Activate Security Scanner Metric Collectors
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** High (P2)
* **Component:** `Collectors`
* **Estimate:** 5 Story Points
* **Assignee / Role:** AppSec / DevSecOps Engineer
* **Description:**
  Authenticate and verify Sentinel's application collectors for security and quality governance platforms: SonarQube Enterprise, OpenText Fortify SSC, Sonatype NexusIQ, and OTKR Compliance.
* **Technical Implementation:**
  * File references:
    * `apps/collector/src/metrics_collection/real/applications/sonarqube_collector.js` (Compute Engine task queue depth).
    * `apps/collector/src/metrics_collection/real/applications/fortify_collector.js` (SSC scan buffer & IIS thread load).
    * `apps/collector/src/metrics_collection/real/applications/nexusiq_collector.js` (Policy evaluation queue & advisory sync rate).
    * `apps/collector/src/metrics_collection/real/applications/otkr_collector.js` (Heuristic compliance scan duration).
* **Acceptance Criteria (Definition of Done):**
  - [ ] SonarQube API token resolves from CyberArk and queries `/api/ce/activity`.
  - [ ] Fortify SSC collector verifies token validity and active scan queue.
  - [ ] NexusIQ collector evaluates policy evaluation throughput.
  - [ ] Zero unhandled rejections if a security engine undergoes scheduled maintenance.

---

### `SENT-407` — Enable Infrastructure Telemetry Probes (AVI VIPs, Database TPS, NAS Mounts, eLDAP)
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** High (P2)
* **Component:** `Collectors`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Infrastructure SRE
* **Description:**
  Enable and verify Sentinel's infrastructure layer probes executing against enterprise network assets: AVI Ingress Balancer, PostgreSQL Database, NAS Storage NFS mounts, and Active Directory LDAP bind gateways.
* **Technical Implementation:**
  * File reference: `apps/collector/src/metrics_collection/real/infrastructure/infra_collector.js`.
  * Probes:
    * AVI Balancer: Ingress connection rates and VIP pool flip health.
    * Database: Active PostgreSQL connections, TPS, and query latency.
    * NAS Storage: NFS v4.1 / SMB latency, IOPS, and disk capacity.
    * SSO / eLDAP: TCP handshake and bind latency ($< 50\text{ ms}$).
* **Acceptance Criteria (Definition of Done):**
  - [ ] All 5 infrastructure layers in `UnifiedHealthMatrix.jsx` render live telemetry.
  - [ ] Database connection pool saturation probe alerts within 10s of threshold breach.
  - [ ] Storage capacity probe accurately reflects enterprise NAS capacity.

---

### `SENT-408` — Setup Python Selenium Synthetic Journey Engine & Fluentd Log Forwarding
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** Medium (P3)
* **Component:** `Observability`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Automation QA / SRE
* **Description:**
  Configure Python 3.10+ Selenium WebDriver with Headless Chromium on the Sentinel host to execute end-to-end synthetic browser login and checkout journeys, and configure Fluentd log forwarders to stream application logs to Sentinel's NAS log directory.
* **Technical Implementation:**
  * Python probe: `apps/collector/src/metrics_collection/real/applications/selenium_prober.py`.
  * Enable toggle in `global_config.yaml`: `collectors.python_metrics.enabled: true`.
  * Configure Fluentd forwarder: `apps/collector/src/logs_collection/fluentd_collector.js`.
  * Log destination: `d:\production_shares\nas_logs\windows_yaml_observability.log`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Headless Chromium executes synthetic login check against Bitbucket and Jenkins every 60s.
  - [ ] Fluentd agent streams logs to the NAS share without buffer overflow.
  - [ ] Browser rendering times recorded as synthetic UX latency metrics.

---

### `SENT-409` — Integrate Standalone Dynatrace API v2 Ingestion for Infrastructure Nodes
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** Medium (P3)
* **Component:** `Observability`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Dynatrace SME / SRE
* **Description:**
  Configure the standalone Dynatrace collector module to query Dynatrace API v2 (`/api/v2/metrics/query` and `/api/v2/problems`) for host health, process groups, and active problems, gated by master configuration toggles.
* **Technical Implementation:**
  * File reference: `apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector.js`.
  * CyberArk resolution: Query `dynatrace/apitoken` for the API token.
  * Enable via `global_config.yaml`: `collectors.dynatrace.enabled: true` (when Profile 2 is selected).
  * In Profile 1, verify standalone function `fetchDynatraceActiveProblems()` can be invoked on-demand to correlate Dynatrace Davis AI problems with Sentinel events.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Dynatrace API queries return HTTP 200 with valid metric points and active problem feeds.
  - [ ] Rate limiting and exponential backoff prevent hitting tenant API quotas.
  - [ ] Test `tests/telemetry_selector.test.js` passes verification.

---

### `SENT-410` — Mount Enterprise NAS UNC Share & Verify Daily Rotating Log Compression
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-04`
* **Priority:** High (P2)
* **Component:** `Storage`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Storage Administrator / Windows Admin
* **Description:**
  Mount the enterprise network-attached storage (NAS) UNC share (`d:\production_shares\nas_logs` or `\\corp.internal\shares\sentinel_logs`) with appropriate service account read/write permissions, and verify rotating log stream behavior.
* **Technical Implementation:**
  * File reference: `packages/logger/logger.js`.
  * Stream configuration: 10 MB file slice cap, daily rotation at midnight (`1d`), 30-day retention with gzip compression (`*.log.gz`).
  * Verify `writeNasLog(level, category, message)` writes structured event logs to the NAS target.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Service account has Full Control NTFS/SMB permissions on target UNC share.
  - [ ] Live log writes succeed to `windows_yaml_observability.log`.
  - [ ] Automatic fallback to `.runtime/nas_logs/` functions if network share is temporarily detached.

---

```
================================================================================
EPIC 5: AI ANOMALY DETECTION, RCA & SERVICENOW ITSM INTEGRATION
================================================================================
```

### `SENT-501` — Validate Real-Time Log Anomaly Regex Matchers against Live Production Streams
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-05`
* **Priority:** High (P2)
* **Component:** `AI/Analytics`
* **Estimate:** 5 Story Points
* **Assignee / Role:** AI / Observability Engineer
* **Description:**
  As a NOC Lead, I need Sentinel's real-time regex anomaly detector to continuously inspect incoming application log streams from Fluentd / Logstash and detect critical operational failure patterns (`OOMKilled`, `No space left on device`, `Database connection pool saturated`) within 5 seconds of occurrence.
* **Technical Implementation:**
  * File reference: `packages/analysis/real_analyzer.js`.
  * Regex signature patterns:
    * `OOMKilled|OutOfMemoryError` $\rightarrow$ Component: `artifactory` $\rightarrow$ Severity: `CRITICAL`.
    * `No space left on device|Filesystem utilization reached 98\.4%` $\rightarrow$ Component: `nas_performance` $\rightarrow$ Severity: `CRITICAL`.
    * `Database connection pool saturated|refused` $\rightarrow$ Component: `database` $\rightarrow$ Severity: `CRITICAL`.
    * `Ingress network bottleneck|saturat(ed|ion)` $\rightarrow$ Component: `avi_load_balancer` $\rightarrow$ Severity: `WARNING`.
  * Verify de-duplication: Prevents alert storming if the same error appears 500 times in 10 seconds.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Ingestion of test error signature triggers alert in database within 5 seconds.
  - [ ] Alert logged to NAS audit stream with category `AI_ENGINE_REAL`.
  - [ ] Alert de-duplication verified (only 1 active alert per component/signature).

---

### `SENT-502` — Activate Linear Regression Predictive Forecasting for Capacity Exhaustion
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-05`
* **Priority:** High (P2)
* **Component:** `AI/Analytics`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Data Science / SRE Engineer
* **Description:**
  As an SRE, I need Sentinel to calculate the slope of resource usage (JVM Heap, DB Connections, NAS Disk Space) using linear regression and raise `PREDICTIVE_WARNING` alerts when capacity is projected to exhaust within 15 minutes.
* **Technical Implementation:**
  * File reference: `packages/analysis/predictive.js` (`calculateLinearRegression`).
  * Rolling window: Last 15 metric points (2.5 minutes of data).
  * Slope evaluation: If slope $> 0.05$ and projected breach time $\le 15$ minutes, raise predictive alert.
  * Auto-resolution: When slope flattens or reverses, automatically resolve active predictive warning.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Unit test verifies linear regression slope and intercept calculations.
  - [ ] Predictive alerts generate descriptive messages (e.g. *"Projected to exhaust capacity in 12 minutes"*).
  - [ ] Automatic alert resolution operates when metrics stabilize.

---

### `SENT-503` — Connect ServiceNow REST API v2 for Active P1/P2/P3 Incident & CHG Correlation
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-05`
* **Priority:** High (P2)
* **Component:** `ITSM`
* **Estimate:** 5 Story Points
* **Assignee / Role:** ServiceNow Integration Specialist
* **Description:**
  As an SRE, I need live ServiceNow ITSM integration to fetch active incident tickets assigned to the `devops aps` assignment group and correlate recent Change Requests (`CHG-*`) with telemetry anomalies occurring 2 weeks before and after deployment gates.
* **Technical Implementation:**
  * File reference: `apps/api/src/server.js` (`GET /api/servicenow/active-incidents`, `GET /api/infra-tickets`).
  * Configure ServiceNow OAuth2 / Basic Auth service account in CyberArk (`servicenow/api_credentials`).
  * Live incident synchronization for assignment group `devops aps`.
  * Display active P1/P2/P3 tickets in `HealthOverview.jsx` with assigned engineer and duration.
* **Acceptance Criteria (Definition of Done):**
  - [ ] ServiceNow API query returns live open incidents for `devops aps`.
  - [ ] UI shows incident ID, severity badge, duration, and assigned engineer.
  - [ ] In offline/sandbox mode, falls back cleanly without breaking dashboard rendering.

---

### `SENT-504` — Validate Config-Drift-to-RCA Causality Auditing in Production NOC Displays
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-05`
* **Priority:** Medium (P3)
* **Component:** `Frontend`
* **Estimate:** 3 Story Points
* **Assignee / Role:** Frontend / UI Engineer
* **Description:**
  Ensure the Root Cause Analytics dashboard and Config Drift feed strictly comply with the production data segregation rules—rendering live correlation feeds when available, and displaying `"Value Not Available"` instead of synthetic mock cards when unmonitored.
* **Technical Implementation:**
  * File reference: `apps/web/src/components/analytics/RcaDashboard.jsx` and `apps/web/src/components/correlation/DriftRcaCorrelationFeed.jsx`.
  * Verify 5-layer dependency flow propagates live statuses.
  * Confirm `tests/env_strict_value_not_available.test.js` passes.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Switching between PROD, STAGING, and DEMO updates RCA view correctly.
  - [ ] No synthetic demo data visible when PROD environment is selected.
  - [ ] Interactive 5-layer flow diagram renders responsive on NOC video walls.

---

```
================================================================================
EPIC 6: AUTONOMOUS SRE REMEDIATION & FOUR-EYES GOVERNANCE
================================================================================
```

### `SENT-601` — Establish Authenticated Webhook Triggers to Production Jenkins Self-Healing Jobs
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-06`
* **Priority:** High (P2)
* **Component:** `SRE`
* **Estimate:** 5 Story Points
* **Assignee / Role:** Jenkins / CI/CD Administrator
* **Description:**
  As an SRE, I need Sentinel's autonomous recovery orchestrator to trigger authenticated Jenkins parameterized recovery jobs (e.g. `artifactory-jvm-recycle`, `nas-log-purge`, `db-connection-flush`) over HTTPS using API tokens resolved from CyberArk.
* **Technical Implementation:**
  * File reference: `packages/remediation/real/jenkins/jenkins_trigger.js` and `packages/remediation/recovery.js`.
  * CyberArk safe lookup: `jenkins/remediation_token`.
  * Production Jenkins webhook endpoint: `https://jenkins.prod.corp/job/${jobName}/buildWithParameters`.
  * Include audit parameters: `TRIGGERED_BY=Sentinel_Autonomous_Recovery`, `ENVIRONMENT=production`, `REASON=${reason}`.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Successful trigger of Jenkins parameterized build verified in Staging/Prod.
  - [ ] TLS certificate verification active (rejecting insecure self-signed certificates).
  - [ ] Every dispatched job logged to `sentinel_audit.log` with HTTP response code.

---

### `SENT-602` — Validate Four-Eyes Dual-Administrator Approval State Machine for Critical Actions
* **Issue Type:** Story
* **Epic Link:** `SENT-EPIC-06`
* **Priority:** High (P2)
* **Component:** `Security`
* **Estimate:** 3 Story Points
* **Assignee / Role:** IT Risk & Compliance Officer
* **Description:**
  As a Compliance Auditor, I need high-risk recovery actions (such as database connection flushes, service container recycles, and firewall failovers) to require two distinct Super Admin signatures before execution, with automated expiration if not approved within 15 minutes.
* **Technical Implementation:**
  * File reference: `packages/remediation/recovery.js` and `apps/web/src/components/sre/SreEnterpriseControl.jsx`.
  * Enforce state transitions: `PENDING_SECOND_APPROVAL` $\rightarrow$ `APPROVED` $\rightarrow$ `EXECUTING` $\rightarrow$ `COMPLETED`.
  * Rule: Requester cannot approve their own action (`initiator !== approver`).
  * Timeout: Requests automatically transition to `EXPIRED` after 15 minutes.
* **Acceptance Criteria (Definition of Done):**
  - [ ] Unit test in `tests/e2e_qa_suite.test.js` passes Four-Eyes dual approval assertion.
  - [ ] Self-approval attempts rejected with `400 Bad Request`.
  - [ ] Approval queue updates in real-time across connected WebSocket clients.

---

### `SENT-603` — Audit & Lock Down SRE Chaos Injection Controls in Production Build
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-06`
* **Priority:** Highest (P1)
* **Component:** `Security`
* **Estimate:** 2 Story Points
* **Assignee / Role:** Application Security Engineer
* **Description:**
  Ensure chaos injection triggers (simulated latency spikes, memory leak injections, outage generators in `CommandCenter.jsx`) are strictly disabled or gated by Super Admin RBAC in production runtime to prevent accidental disruption of live systems.
* **Technical Implementation:**
  * File reference: `apps/api/src/server.js` (`/api/chaos/*`) and `apps/web/src/components/sre/CommandCenter.jsx`.
  * Block `/api/chaos/inject` if `runtimeEnvironment === 'prod'` unless an explicit emergency maintenance override header is present.
  * Hide or disable Chaos Engineering triggers in the frontend UI when `PROD` is the active environment.
* **Acceptance Criteria (Definition of Done):**
  - [ ] `POST /api/chaos/inject` returns `403 Forbidden` in production mode.
  - [ ] UI displays informative badge indicating Chaos Controls are locked in Production.

---

```
================================================================================
EPIC 7: CI/CD QUALITY GATES & RELEASE VERIFICATION
================================================================================
```

### `SENT-701` — Activate Bitbucket Pipelines & GitHub Actions Dual-OS Matrix Builds
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-07`
* **Priority:** High (P2)
* **Component:** `CI/CD`
* **Estimate:** 3 Story Points
* **Assignee / Role:** CI/CD Engineer
* **Description:**
  Activate and verify automated continuous integration pipelines in both Bitbucket Pipelines (`bitbucket-pipelines.yml`) and GitHub Actions (`.github/workflows/ci.yml`), running cross-platform matrix verification on Ubuntu and Windows.
* **Technical Implementation:**
  * File reference: `.github/workflows/ci.yml` and `bitbucket-pipelines.yml`.
  * Ensure steps execute:
    1. Node.js setup matching `.nvmrc` (`v24.x` / `v20.x`).
    2. Dependency installation (`npm install`).
    3. Severity constants linting (`npm run lint:constants`).
    4. Full test suite execution (`npm test` — all 11 suites).
    5. Production bundle build (`npm run build`).
* **Acceptance Criteria (Definition of Done):**
  - [ ] Pipeline runs automatically on push to `main`, `master`, and `release/*`.
  - [ ] All 11 test suites pass green in CI runner.
  - [ ] Build finishes under 4 minutes.

---

### `SENT-702` — Execute Pre-Go-Live User Acceptance Testing (UAT) & Failover Verification
* **Issue Type:** Task
* **Epic Link:** `SENT-EPIC-07`
* **Priority:** Highest (P1)
* **Component:** `QA/NOC`
* **Estimate:** 5 Story Points
* **Assignee / Role:** SRE Lead & NOC Quality Manager
* **Description:**
  Execute comprehensive end-to-end operational verification in the Staging environment prior to production cutover, validating alert propagation, dashboard rendering, runbook execution, and failover behavior under simulated network load.
* **Technical Implementation:**
  * File reference: `PRODUCTION_GUIDE.md` (Section 4: Master Verification Protocol).
  * Run automated verification: `npm test`.
  * Validate UI workflows: Health Matrix drilldown, RCA timeline scrubbing, Monthly Rota schedule editor, and Admin YAML viewer.
  * Conduct simulated failover of primary database and load balancer nodes.
* **Acceptance Criteria (Definition of Done):**
  - [ ] 100% test pass rate across all regression suites.
  - [ ] Zero unhandled frontend exceptions in browser developer console.
  - [ ] SRE NOC team completes operational sign-off and cutover approval.

---

## 🚀 Jira CSV Import Guide

To import these tasks directly into Jira Cloud or Jira Data Center:
1. Open **Jira** $\rightarrow$ **Project Settings** $\rightarrow$ **External System Import** $\rightarrow$ **CSV**.
2. Map the fields as follows:
   * `Issue Key` $\rightarrow$ **Issue Id** (or External Id)
   * `Type` $\rightarrow$ **Issue Type** (`Epic`, `Story`, `Task`)
   * `Summary` $\rightarrow$ **Summary**
   * `Description` $\rightarrow$ **Description**
   * `Priority` $\rightarrow$ **Priority**
   * `Component` $\rightarrow$ **Component/s**
   * `Estimate` $\rightarrow$ **Story Points**
   * `Epic Link` $\rightarrow$ **Epic Link** / **Parent**
3. Execute the import to populate your production readiness sprint backlog.
