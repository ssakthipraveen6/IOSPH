# 🧭 Project Sentinel — Team Onboarding & Operations Handbook
**Target Audience**: SREs, NOC Engineers, DevSecOps Engineers, Platform Architects  
**Classification**: Internal / Confidential (BFSI Enterprise MNC)  
**Last Updated**: October 2026

---

## 1. Welcome to Project Sentinel

Project Sentinel is an enterprise self-hosting observability and autonomous remediation platform designed for critical financial services infrastructure. It bridges the gap between telemetry ingestion (OpenTelemetry, Prometheus, Dynatrace), statistical AI anomaly detection ($Z$-score and regex pattern recognition), and automated self-healing with strict Segregation of Duties (SOD / Four-Eyes dual approval).

```
  ┌─────────────────────────────────────────────────────────────┐
  │                 Telemetry Sources                           │
  │  (OTel OTLP / HostMetrics, Synthetic Probers, Dynatrace)    │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │         Sentinel Core (Node.js / Express / TimescaleDB)      │
  │   - Z-Score Anomaly Detector (ai_analysis/)                 │
  │   - W3C Trace Injection & Propagator (backend/tracing.js)   │
  │   - Event & Audit Store with HMAC-SHA256 (database/)        │
  │   - Jenkins Circuit Breaker & Safe Recovery (remediation/)   │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
  ┌──────────────────────────────┐              ┌──────────────────────────────┐
  │  Sentinel React Dashboard    │              │  Enterprise Systems          │
  │  - Health & Overview         │              │  - ServiceNow ITSM (Incidents)│
  │  - SLO & Error Budgets       │              │  - Jenkins CI/CD Orchestration│
  │  - Anomaly Feed & Outliers   │              │  - Active Directory / eLDAP  │
  │  - Trace Explorer & Audit    │              │  - CyberArk CCP Vault        │
  └──────────────────────────────┘              └──────────────────────────────┘
```

---

## 2. Prerequisites & Environment Setup

### Required Tools
* **Node.js**: v20.x or v22.x LTS (tested on v20+)
* **Python**: 3.10+ (for headless Selenium synthetic browser checks)
* **PowerShell**: 7+ (Windows Server native environment)
* **Git**: with corporate enterprise certificate bundle configured
* **PostgreSQL / TimescaleDB**: local instance or test container on port 5432

### Corporate Credentials & Access Matrix
Ensure you request access to the following AD Security Groups and CyberArk Safes:
- `SG-SENTINEL-OPERATORS`: View telemetry, acknowledge alerts, trigger low-risk runbooks.
- `SG-SENTINEL-SRE-LEADS`: Approve Four-Eyes remediation workflows, reset circuit breakers.
- `SG-SENTINEL-SUPERADMINS`: Modify YAML topology, rotate signing certificates.
- `CyberArk Safe`: `APP-SENTINEL-NONPROD` (for dev/staging secrets).

---

## 3. 10-Minute Local Quickstart

### Step 1: Clone & Link Workspaces
```powershell
git clone <repo-url> sentinel
cd sentinel/sentinel-webdesign
npm run setup
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```powershell
cp .env.example .env
```
Ensure the following minimal settings are present for local testing:
```ini
NODE_ENV=development
PORT=3001
JWT_SECRET=local-development-secret-minimum-32-chars-long
USE_SIMULATED_COLLECTORS=true
```

### Step 3: Run Baseline Regression Suite
Validate that all unit and integration tests pass on your machine:
```powershell
npm test
```
*Expected: 27 test suites passing (100% Green).*

### Step 4: Launch Development Servers
```powershell
# Launches backend API on port 3001 and Vite frontend on port 5173
npm run dev
```
Open your browser to `http://localhost:5173` (or `http://localhost:3001` for the production bundle).

---

## 4. Directory & Module Navigation

| Directory | Responsibilities | Key Contacts |
|:---|:---|:---|
| [`backend/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/backend) | Express API, WebSocket handler, W3C tracing middleware, auth guards | Backend Platform Team |
| [`frontend/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/frontend) | React 19 + Vite UI components, CSS styling, stateful controllers | Frontend Guild |
| [`ai_analysis/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/ai_analysis) | $Z$-Score anomaly scoring, baseline rolling windows, log classifiers | Data Science / SRE |
| [`remediation/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/remediation) | Jenkins runbook execution, Circuit Breaker state machine, SOD governance | Automation / SRE |
| [`database/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/database) | PostgreSQL pool, write-behind hot cache, HMAC immutable event store | DBA / Core Platform |
| [`config/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/config) | `global_config.yaml`, `slos.yaml`, declarative system topologies | DevSecOps Leads |
| [`tests/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/tests) | 27 automated test suites for continuous validation | QA / All Engineers |

---

## 5. Key Operational Concepts

### 1. Strict Environment Isolation
Sentinel supports three isolated environments:
- **`prod`**: Real telemetry only. Synthetic data generators are permanently disabled.
- **`staging`**: UAT/pre-prod telemetry with optional simulation feeds.
- **`demo`**: Sandbox environment for training and demos. Demo loops terminate immediately when switching away to prevent state bleed.

### 2. Four-Eyes Principle (Segregation of Duties)
For any high-severity autonomous runbook (e.g. database failover, cluster restarts):
- The user who triggers the recovery **cannot** be the user who approves it.
- Approval requests expire automatically after 2 hours.
- Every trigger and approval is cryptographically logged with user identity and W3C `traceparent`.

### 3. Circuit Breakers
To prevent cascade failures during upstream outages, Jenkins triggers are wrapped in a 3-state circuit breaker:
- `CLOSED`: Normal operation.
- `OPEN`: 3 consecutive failures trips the breaker; subsequent jobs are paused for 30 minutes.
- `HALF-OPEN`: A single trial recovery is executed; success resets to `CLOSED`, failure re-trips to `OPEN`.

---

## 6. Daily Routine for SREs & NOC

1. **Morning Inspection (08:30 IST / 09:00 GMT)**:
   - Check the **SRE Center** tab for 30-day SLO burn rates.
   - Verify that the Jenkins Circuit Breaker is `CLOSED`.
   - Review any $Z \ge 3.0\sigma$ outlier detections in the **Metrics & Anomaly** feed.
2. **Handling Critical Alerts**:
   - Check the **Operations** tab for auto-created ServiceNow incidents.
   - If an automated runbook is pending approval, verify the RCA hypothesis, ensure you are not the original triggerer, and execute approval.
3. **End of Shift Handover**:
   - Verify zero un-drained events in the offline ring buffer.
   - Sign off on audit trail integrity via the **Admin & Compliance** tab.
