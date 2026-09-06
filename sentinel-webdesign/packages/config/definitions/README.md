# Unified Collection Definitions (`packages/config/definitions/`)

This directory is the single source of truth for all monitored applications, infrastructure layers, metrics policies, log files, and CyberArk credentials in Project Sentinel.

---

## Architecture Overview (Option A: Self-Contained Manifests)

Each YAML file in this directory encapsulates all requirements for a monitored target:
- **`app-*.yaml`**: Applications, SCM repositories, CI/CD systems, and security scanners.
- **`infra-*.yaml`**: Infrastructure compute nodes, load balancers, storage filers, databases, and network devices.
- **`telemetry-pipeline.yaml`**: Fleet-wide telemetry collection selector profiles.

---

## Adding a New Target (Template)

To onboard a new application, copy the template below into `packages/config/definitions/app-<your-tool-id>.yaml`:

```yaml
id: "your_tool_id"
kind: "application"                  # "application" | "infrastructure"
display_name: "Your Tool Display Name"
category: "ci_cd"                    # "ci_cd" | "source_control" | "security_scanner" | "load_balancer" | "storage" | "compute"
tier: "Tier-1 Mission Critical"
log_tag: "[YOUR-TAG]"

endpoints:
  prod:
    api: "https://your-tool-prod.internal.corp/api"
  stg:
    api: "https://your-tool-stg.internal.corp/api"

layers:
  api_token:
    credential_purpose: "api_token"
  sso:
    api: "https://sso-auth-prod.internal.corp/oauth2/token"
    credential_purpose: "sso"
  avi:
    api: "https://avi-prod.internal.corp/api/v1/telemetry"
    credential_purpose: null

servers:
  unix:
    - node: "your-tool-server-1"
      api: "https://linux-compute-prod-1.internal.corp/api/v1/metrics"
  windows: []

# Metrics Scrape & Anomaly Detection Policy
metrics:
  provider: "opentelemetry"          # "opentelemetry" | "dynatrace" | "native"
  scrape_interval: "30s"
  health_thresholds:
    response_time_warn_ms: 500
    response_time_crit_ms: 1200

metrics_baseline:
  responseTime: 85
  successRate: 99.8
  requests: 45

# Log Collection & Retention Policy
logs:
  log_tag: "[YOUR-TAG]"
  log_path: "d:\\production_shares\\nas_logs\\your_tool.log"
  retention_days: 30

# CyberArk Vault Credential Mapping
credentials:
  safe: "SF-YOURTOOL-PROD"
  objects:
    api_token: "YOURTOOL-API-TOKEN"
    sso: "YOURTOOL-SSO-SVC"

# SRE Automated Remediation Playbook
jenkins_remediation_job: "JOB_RESTART_YOUR_TOOL"
```
