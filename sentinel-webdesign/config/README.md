# ⚙️ Project Sentinel — Configuration Root (`/config`)

This directory is the **single source of truth** for all user-configurable parameters, targets, environments, telemetry settings, and credential registries across Project Sentinel.

---

## 📁 Directory Structure

```text
config/
├── .env.example        # Environment variables & server port template
├── global.yaml         # Master environment toggles, active profile, URLs, & switches
├── telemetry.yaml      # Telemetry profiles (Profile 1: OTel, Profile 2: Dynatrace, Profile 3: Prometheus)
├── cyberark.yaml       # CyberArk CCP Safes & Object bindings for secret resolution
├── apps/               # Monitored application topologies (one YAML per toolchain app)
│   ├── bitbucket.yaml
│   ├── jenkins.yaml
│   ├── sonarqube.yaml
│   ├── artifactory.yaml
│   └── ... (20 apps)
└── infra/              # Monitored shared infrastructure layers
    ├── avi.yaml
    ├── k8s.yaml
    ├── docker.yaml
    ├── unix.yaml
    ├── windows.yaml
    ├── nfs.yaml
    └── sso-eldap.yaml
```

---

## 🚀 How to Maintain Configurations

### 1. Changing Environments & Master Toggles
Edit [`global.yaml`](./global.yaml):
- Set `environment: "production"` or `"staging"` or `"demo"`
- Enable/disable collectors under `collectors` (e.g. `dynatrace`, `python_metrics`)
- Enable/disable specific applications under `applications_enabled`
- Enable/disable infrastructure layers under `components_enabled`

### 2. Onboarding a New Application
Add a new YAML file to `config/apps/<tool-id>.yaml` declaring:
- `id`: unique tool identifier
- `display_name`: human-readable UI label
- `category`: `scm`, `ci_cd`, `artifact_repository`, `security_scanner`, etc.
- `endpoints`: `prod` and `stg` API URLs
- `layers`: AVI, DB, NFS, LDAP, Docker, K8s bindings

### 3. Onboarding Infrastructure Targets
Add or update YAML in `config/infra/<layer-id>.yaml` declaring endpoints, poll intervals, and health targets.

### 4. Updating Credentials & Vault Access
Update [`cyberark.yaml`](./cyberark.yaml) to map `safe` and `objects` for applications or infrastructure to CyberArk CCP.
