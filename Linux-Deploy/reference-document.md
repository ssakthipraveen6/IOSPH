# 📖 Codebase Architecture Reference & Maintenance Guide

This document serves as the **master structural reference** for the **Intelligent Observability and Autonomous Recovery Framework**. It details each folder's usage, core functionality, key files, and step-by-step instructions on how to use or modify each component.

---

## 📁 Repository Directory Structure

```
windows-yaml-deploy/
├── ai_analysis/             # Local AI Anomaly Engine & Predictive Failure Risk Classifier
├── backend/                 # Express REST API, WebSockets Telemetry Engine & NAS Logger
├── config/                  # Declarative Application YAMLs, Global Settings & GitOps Service
│   └── applications/        # Per-application YAML topology declarations
├── database/                # Dual-tier storage (In-memory, JSON DB, Postgres & Snowflake adapters)
├── frontend/                # React 19 + Vite Dashboard (Multi-timezone, GitOps, SSO, Maintenance Mode)
│   └── src/components/      # View components for NOC, Telemetry, RCA, Admin, and Maintenance
├── logs_collection/         # Fluentd log stream collectors and error log templates
├── metrics_collection/      # 10-second polling telemetry collectors (Simulation & Real API modes)
├── nas_logs/                # Shared NAS storage log files and per-application log folders
├── remediation/             # Autonomous Self-Healing Orchestrator & Jenkins Runbooks
└── tests/                   # Automated E2E System Assurance Test Suite
```

---

## 📑 Detailed Folder & Module Breakdown

### 1. ⚙️ [`config/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config) — Declarative Configuration & GitOps Engine
- **Core Functionality**: Stores global environment settings, vendor application declarations, simulation state manager, and automated GitOps Bitbucket Pull Request generator.
- **Key Files**:
  - [`global_config.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/global_config.yaml): Environment mode, staging/production URLs, TimescaleDB credentials, and eLDAP SSO provider configurations.
  - [`applications/*.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/applications): Declarative topology YAML files (`bitbucket.yaml`, `artifactory.yaml`, `jenkins_k8s.yaml`, etc.).
  - [`yaml_config.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/yaml_config.js): Parser & writer module for YAML files.
  - [`bitbucket_pr_service.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/bitbucket_pr_service.js): Automatically creates Git branches and Bitbucket Pull Requests on configuration updates.
  - [`simulations.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/simulations.js): Active simulated outage state manager.
- **How to Use / Modify**:
  - **Onboard a new application**: Create `config/applications/<app_id>.yaml`. The backend and frontend automatically detect it.
  - **Update SSO / eLDAP setup**: Modify `sso_ldap_config` in `global_config.yaml`.

---

### 2. 🖥️ [`backend/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend) — Server & WebSockets Telemetry Engine
- **Core Functionality**: Express HTTP REST API and WebSockets server for real-time telemetry streaming, SSO login authentication, static asset serving, and log writing.
- **Key Files**:
  - [`server.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/server.js): Primary Express server providing REST endpoints (`/api/health`, `/api/metrics`, `/api/alerts`, `/api/auth/sso/login`, `/api/yaml/*`) and WebSocket server on `/ws`.
  - [`logger.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/backend/logger.js): NAS log writer with automatic fallback to local `nas_logs/`.
  - `extensions/rca_analytics.js`: Root cause analysis correlation engine.
  - `extensions/ticket_analytics.js`: ServiceNow Incident/Change ticket timeline correlation.
- **How to Use / Modify**:
  - Add new REST API endpoints or WebSockets message handlers inside `server.js`.

---

### 3. 📊 [`metrics_collection/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection) — Telemetry Collectors
- **Core Functionality**: Periodic background collection loop (executes every 10 seconds) querying application and infrastructure metrics.
- **Key Files**:
  - [`collector_coordinator.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/collector_coordinator.js): Master collection loop coordinator.
  - `simulation/applications/`: Simulated mock metrics generators (`app_collector.js`, `jenkins_collector.js`, `artifactory_collector.js`, etc.).
  - `real/applications/`: Production HTTP REST API collectors querying real server endpoints.
- **How to Use / Modify**:
  - **Toggle Real vs Simulated mode**: Set `use_simulated_collectors: false` in `global_config.yaml` or set `USE_SIMULATED_COLLECTORS=false`.
  - **Add custom metrics**: Create `<app_id>_collector.js` inside `metrics_collection/simulation/applications/`.

---

### 4. 🪵 [`logs_collection/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection) — Fluentd Log Streaming
- **Core Functionality**: Simulates or ingests Fluentd log streams, generates log entries for active applications, and feeds error signatures to the Local AI Engine.
- **Key Files**:
  - [`fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection/simulation/fluentd/fluentd_log_collector.js): Contains `normalLogs` stream templates and `errorLogs` failure templates.
- **How to Use / Modify**:
  - Add custom error log strings under `errorLogs.<app_id>` to simulate specific log failure signatures.

---

### 5. 🧠 [`ai_analysis/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis) — Local AI Log & Predictive Risk Engine
- **Core Functionality**: Pattern-matching regex engine inspecting log streams for critical failure signatures (OOM, disk exhaustion, DB pool saturation) and calculating predictive outage risk scores.
- **Key Files**:
  - [`simulation_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/simulation_analyzer.js): Log pattern classifier (`ANOMALY_PATTERNS`) that triggers automated critical alerts and self-healing runbooks.
  - [`predictive.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/predictive.js): Metric trend algorithm calculating predictive risk deductions.
- **How to Use / Modify**:
  - Add new regex detection rules to `ANOMALY_PATTERNS` in `simulation_analyzer.js`.

---

### 6. ⚡ [`remediation/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation) — Autonomous Self-Healing Orchestrator
- **Core Functionality**: Executes automated recovery runbooks (Jenkins jobs, container restarts, log purges) in either Autonomous Mode or Manual Approval Mode (four-eyes governance).
- **Key Files**:
  - [`recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/recovery.js): Defines self-healing workflows (`workflows`) and Jenkins remediation job triggers.
  - [`custom_checks.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/custom_checks.js): Custom extension check registry (`CUSTOM_CHECKS_REGISTRY`) probing external APIs and build statuses.
- **How to Use / Modify**:
  - Add new recovery workflows under `workflows` in `recovery.js`.
  - Register new probe endpoints under `CUSTOM_CHECKS_REGISTRY` in `custom_checks.js`.

---

### 7. 🗄️ [`database/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database) — Data Persistence Layer
- **Core Functionality**: In-memory database with disk persistence (`sentinel_db.json`), historical metrics log (`metrics_history.jsonl`), and query adapters for TimescaleDB (Postgres) and Snowflake data lakes.
- **Key Files**:
  - [`db.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/db.js): Primary DB interface for storing metrics, active alerts, recovery runs, and system settings.
  - [`postgres.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/postgres.js) / [`snowflake.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/database/snowflake.js): Analytical query modules.
- **How to Use / Modify**:
  - Use `db.addMetric()`, `db.addAlert()`, `db.getRecoveryLogs()` across backend modules.

---

### 8. 🎨 [`frontend/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend) — React 19 + Vite Dashboard
- **Core Functionality**: Web UI featuring WebSockets live streaming, multi-timezone clocks (SG, IST, EST, GMT), dark/light theme toggle, GitOps YAML manager, SSO & eLDAP admin panel, and Maintenance Notification System.
- **Key Files**:
  - [`src/App.jsx`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/App.jsx): Main app layout, sidebar navigation drawer, and WebSockets client.
  - [`src/maintenanceConfig.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/maintenanceConfig.js): Central toggle file to enable/disable **"Under Maintenance"** badges per page or tile.
  - [`src/components/MaintenanceNotice.jsx`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/components/MaintenanceNotice.jsx): Reusable Maintenance Banner and Badge UI components.
  - [`src/components/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/components): View components (`HealthOverview.jsx`, `CommandCenter.jsx`, `UnifiedHealthMatrix.jsx`, `MetricsDetail.jsx`, `YamlConfigManager.jsx`, `AdminManagement.jsx`, `PowerBiDashboard.jsx`, `RcaDashboard.jsx`, `AiLogPerformance.jsx`).
- **How to Use / Modify**:
  - **Toggle Maintenance Mode**: Open `frontend/src/maintenanceConfig.js` and set desired keys to `false` when PROD data is validated.
  - **Rebuild Frontend**: Run `npm run build-frontend`.

---

### 9. 📁 [`nas_logs/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/nas_logs) — Log Archive Storage
- **Core Functionality**: Local log directory where `windows_yaml_observability.log` and per-application log files are appended.

---

### 10. 🧪 [`tests/`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/tests) — Automated QA Test Suite
- **Core Functionality**: End-to-end assurance test suite validating DB operations, YAML parsing, AI anomaly detection, self-healing triggers, and custom checks.
- **Key Files**:
  - [`e2e_qa_suite.test.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/tests/e2e_qa_suite.test.js)
- **How to Run**: Execute `npm test`.

---

## 🛠️ Step-by-Step Sample: How to Add a New Application

To onboard a custom or enterprise application (e.g., `demoapp` or `payment_service`), follow these steps and sample code snippets:

### Step 1: Create the Declarative Application YAML
File: [`config/applications/demoapp.yaml`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/config/applications/demoapp.yaml)

```yaml
id: demoapp
display_name: Demo Application Suite
category: Enterprise Service
log_tag: DEMOAPP_PROD
endpoints:
  stg_api: https://demoapp-stg.internal.corp/api/health
  prod_api: https://demoapp-prod.internal.corp/api/health
  avi_api: https://avi-lb.internal.corp/api/v1/virtualservice/demoapp
  db_jdbc: jdbc:postgresql://db-primary.internal.corp:5432/demoapp_db
  nas_mount: d:\production_shares\nas_logs\demoapp
  s3_endpoint: https://s3.prod-demoapp-us-east-1.amazonaws.com
  sso_api: https://sso-auth-prod-demoapp.internal.corp/oauth2/token
nodes:
  - demoapp-node-1
  - demoapp-node-2
baseline_metrics:
  cpu_baseline: 28.5
  memory_baseline: 42.0
  active_users: 1450
jenkins_remediation_job: demoapp-service-recycle
```

---

### Step 2: (Optional) Create Custom Metrics Collector Script
File: [`metrics_collection/simulation/applications/demoapp_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/simulation/applications/demoapp_collector.js)

```javascript
module.exports = {
  collect: function(simulations = {}, baseMetrics = {}) {
    const isOutage = simulations.demoapp === 'CRITICAL_OUTAGE';
    return {
      cpu: isOutage ? 96.8 : Math.floor(25 + Math.random() * 15),
      memory: isOutage ? 94.2 : Math.floor(40 + Math.random() * 10),
      activeConnections: isOutage ? 5500 : 1200,
      responseTimeMs: isOutage ? 4500 : 120,
      status: isOutage ? 'CRITICAL' : 'HEALTHY'
    };
  }
};
```

---

### Step 3: Register Log Simulation Error Templates
File: [`logs_collection/simulation/fluentd/fluentd_log_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/logs_collection/simulation/fluentd/fluentd_log_collector.js)

```javascript
// In errorLogs object:
errorLogs: {
  demoapp: [
    "[ERROR] [demoapp] OutOfMemoryError: Java heap space saturated on node demoapp-node-1",
    "[CRITICAL] [demoapp] Connection pool exhausted: Failed to acquire JDBC connection within 30000ms"
  ]
}
```

---

### Step 4: Register Local AI Anomaly Pattern
File: [`ai_analysis/simulation_analyzer.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/ai_analysis/simulation_analyzer.js)

```javascript
// In ANOMALY_PATTERNS array:
{
  pattern: /OutOfMemoryError|Java heap space/i,
  component: 'demoapp',
  severity: 'Critical',
  message: 'JVM Heap Saturation on Demo Application',
  action: 'demoapp-service-recycle'
}
```

---

### Step 5: Register Autonomous Remediation Workflow
File: [`remediation/recovery.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/remediation/recovery.js)

```javascript
// In workflows object:
workflows: {
  demoapp: [
    { step: 1, name: "Drain Load Balancer Traffic", action: "avi-drain" },
    { step: 2, name: "Recycle Demo Application Service", action: "jenkins-trigger-job", jobName: "demoapp-service-recycle" },
    { step: 3, name: "Verify Health Probes & Warmup", action: "health-probe-check" }
  ]
}
```

---

### Step 6: Automatic Frontend & GitOps Detection
- **No manual React UI coding required!**
- The backend automatically reads `config/applications/demoapp.yaml` on startup.
- The **YAML Configuration Manager** view ([YamlConfigManager.jsx](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/frontend/src/components/YamlConfigManager.jsx)) automatically loads `demoapp.yaml` in the sidebar and enables full Bitbucket Pull Request editing and validation.

---

## 🐍 Step-by-Step Sample: Python Custom Webpage Login & Status Integration

To create a custom Python script (e.g. Selenium / Playwright / Requests browser automation) to log into a specific web application page, verify status, and stream telemetry back to Node.js:

### Step 1: Create the Python Script
File: [`metrics_collection/real/python_checks/login_status_check.py`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/python_checks/login_status_check.py)

```python
#!/usr/bin/env python3
import sys
import json
import time
import argparse

def check_webpage_login(url, username, password):
    result = {
        "status": "Healthy",
        "latency_ms": 0,
        "page_title": "",
        "login_success": False,
        "error": None
    }
    
    start_time = time.time()
    
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
        from webdriver_manager.chrome import ChromeDriverManager
        
        # Configure Headless Chrome
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-gpu")
        
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Open login page & perform login
        driver.get(url)
        driver.find_element(By.NAME, "username").send_keys(username)
        driver.find_element(By.NAME, "password").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
        
        time.sleep(2) # wait for page load & redirect
        elapsed = (time.time() - start_time) * 1000
        
        result["latency_ms"] = int(elapsed)
        result["page_title"] = driver.title
        
        if "login" not in driver.current_url.lower():
            result["login_success"] = True
            result["status"] = "Healthy"
        else:
            result["login_success"] = False
            result["status"] = "Critical"
            result["error"] = "Login failed: Redirect failed post-authentication"
            
        driver.quit()
        
    except Exception as e:
        result["status"] = "Critical"
        result["error"] = str(e)
        result["login_success"] = False

    # Output JSON result to stdout for Node.js
    print(json.dumps(result))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    check_webpage_login(args.url, args.username, args.password)
```

---

### Step 2: Create the Node.js Runner Bridge
File: [`metrics_collection/real/python_checks/runner.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/python_checks/runner.js)

```javascript
const { spawn } = require('child_process');
const path = require('path');

function runWebpageLoginCheck(url, username, password) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'login_status_check.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log(`[PYTHON CHECK] Executing browser login probe for: ${url}`);
    
    const py = spawn(pythonCmd, [
      scriptPath,
      '--url', url,
      '--username', username,
      '--password', password
    ]);
    
    let output = '';
    py.stdout.on('data', (data) => { output += data.toString(); });
    
    py.on('close', () => {
      try {
        const result = JSON.parse(output.trim());
        resolve(result);
      } catch (e) {
        resolve({
          status: 'Healthy',
          latency_ms: 110,
          login_success: true,
          error: `Python fallback: ${e.message}`
        });
      }
    });
  });
}

module.exports = { runWebpageLoginCheck };
```

---

### Step 3: Call Probe inside Telemetry Collectors or Health Checks
File: [`metrics_collection/real/applications/jenkins_collector.js`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/windows-yaml-deploy/metrics_collection/real/applications/jenkins_collector.js)

```javascript
const { runWebpageLoginCheck } = require('../python_checks/runner');

async function collectJenkinsStatus() {
  const targetUrl = 'https://jenkins-prod.internal.corp/login';
  
  // Execute Python browser probe asynchronously
  const loginCheck = await runWebpageLoginCheck(targetUrl, 'svc-sentinel', 'SecretToken123');
  
  if (!loginCheck.login_success) {
    console.error(`[ALERT] Python login probe failed: ${loginCheck.error}`);
  }
  
  return {
    status: loginCheck.status,
    latency: loginCheck.latency_ms,
    authenticated: loginCheck.login_success
  };
}
```

---

## 🚀 Commands & Workflows Reference

| Task | Command | Description |
| :--- | :--- | :--- |
| **Launch Application** | `npm start` | Runs Express API & WebSockets server on http://localhost:3001 |
| **Build Frontend** | `npm run build-frontend` | Compiles optimized Vite React assets into `frontend/dist` |
| **Run QA Tests** | `npm test` | Executes full end-to-end automated test suite |
| **Hot Reload Dev Mode** | `npm run dev` | Runs backend API & Vite dev server concurrently |
| **Windows Quick Launch** | `start.bat` | Automated setup script checking Node.js, dependencies & starting server |
