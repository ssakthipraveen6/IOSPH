# Project Sentinel: Enterprise Agent Deployment Guide

This directory contains production deployment automation for rolling out **OpenTelemetry (OTel) Collector** and **Prometheus Node Exporters** across Linux, Windows Server, and Kubernetes clusters.

All agent configurations push standard OTLP metrics directly to Sentinel's application URL (`https://sentinel.yourbank.internal/v1/metrics`) over standard corporate HTTPS (`port 443`).

---

## Directory Structure

```
deployments/
├── Jenkinsfile                        # CI/CD Automated Rollout Pipeline (Ansible + Jenkins)
├── ansible/                           # Linux automated mass-rollout
│   ├── playbook_linux_otel.yml        # Deploys otelcol-contrib RPM via systemd
│   ├── playbook_linux_node_exporter.yml # Deploys Prometheus node_exporter binary
│   └── inventory.ini                  # Target fleet inventory
├── powershell/                        # Windows Server automated rollout
│   ├── deploy_windows_otel.ps1        # Deploys OTel MSI package & Windows service
│   └── deploy_windows_exporter.ps1    # Deploys windows_exporter MSI
├── k8s/                               # Kubernetes DaemonSet manifests
│   ├── otel_collector_daemonset.yaml  # OTel Collector DaemonSet with kubeletstats
│   └── prometheus_node_exporter_daemonset.yaml
└── opentelemetry_configs/             # Master OTel YAML configurations
    ├── otel_linux_config.yaml         # Linux hostmetrics + docker_stats
    └── otel_windows_config.yaml       # Windows hostmetrics + IIS perfcounters
```

---

## 0. Automated Rollout via Jenkins Pipeline (`deployments/Jenkinsfile`)

Point your CloudBees Jenkins / Jenkins instance to `deployments/Jenkinsfile`:
- **Parameters Available:**
  - `ENVIRONMENT`: `staging` / `production`
  - `TARGET_HOSTS`: `linux_servers` or specific hostname
  - `DEPLOY_ACTION`: `deploy`, `restart`, `status_check`, or `uninstall`
  - `DRY_RUN`: Check mode (`--check --diff`)
- **CyberArk / Vault Bindings:**
  - `SSH_KEY`: SSH key for target host service account
  - `SF_INFRA_OTEL_TOKEN`: CyberArk OpenTelemetry ingestion token


---

## 1. Deploying to Linux Fleet (via Ansible)

1. Verify target hosts in `deployments/ansible/inventory.ini`.
2. Execute the Ansible playbook:
   ```bash
   ansible-playbook -i deployments/ansible/inventory.ini deployments/ansible/playbook_linux_otel.yml
   ```
3. The collector starts as a systemd service (`systemctl status otelcol-contrib`).

---

## 2. Deploying to Windows Server Fleet (via PowerShell / SCCM)

Execute from an elevated PowerShell session (or deploy via SCCM / Group Policy):
```powershell
& ".\deployments\powershell\deploy_windows_otel.ps1" `
    -ArtifactoryMsiUrl "https://artifactory-prod.internal.corp/artifactory/binaries/otelcol-contrib_0.95.0_windows_amd64.msi" `
    -SentinelEndpoint "https://sentinel.yourbank.internal/v1/metrics"
```

---

## 3. Deploying to Kubernetes Clusters (via kubectl / Helm)

Apply the DaemonSet manifest:
```bash
kubectl apply -f deployments/k8s/otel_collector_daemonset.yaml
```

---

## 4. Ingestion Verification

When agents push metrics to Sentinel, verify ingestion in real-time:
* **OTLP Ingestion Endpoint:** `POST /v1/metrics`
* **Real-time Log stream:** View `[OTLP INGEST] Processed N telemetry metrics from OTel agents.` in Sentinel UI and NAS logs.
