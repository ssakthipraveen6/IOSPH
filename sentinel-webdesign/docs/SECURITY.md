# Project Sentinel — Security Policy & Vulnerability Disclosure

## 1. Governance & Scope

Project Sentinel is a Tier-1 enterprise observability and autonomous recovery platform operating in regulated banking, financial services, and insurance (BFSI) environments. All components, telemetry pipelines, and integrations are subject to corporate Information Security and CyberArk vault policies.

### In-Scope Assets
- **Application Services**: `backend/` (REST endpoints, WebSocket broadcasts, JWT authentication).
- **Frontend Portal**: `frontend/` (React Single-Page Application, session state management).
- **Telemetry Ingestion**: `metrics_collection/`, `logs_collection/` (OTLP receivers, Prometheus scrapers, Syslog/Fluentd streams).
- **Core Modules**: `database/`, `logger/`, `backend/config/`, `shared/`.
- **Credential Providers**: CyberArk Central Credential Provider (CCP) and Vault integrations in `backend/config/cyberark/`.

### Out-of-Scope
- Vulnerabilities solely involving simulated/mock data in development/demo modes without production attack vectors.
- Denial-of-Service attacks targeting test-environment infrastructure.

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability or suspect a credential leak, please report it immediately through internal enterprise security channels:

- **Enterprise Security Operations Center (SOC)**: `soc-incident@enterprise.corp`
- **Product Security Incident Response Team (PSIRT)**: `infosec-sentinel@enterprise.corp`
- **Emergency Escalation**: PagerDuty Escalation: `BFSI-SEC-PRIORITY-1`

> [!CAUTION]
> **DO NOT** file public GitHub issues, Slack channel announcements, or unencrypted emails disclosing suspected vulnerabilities.

### Required Information
When submitting a report, include:
1. Description of the vulnerability and attack vector.
2. Affected components and version/commit hash.
3. Proof-of-concept steps or sanitized reproduction script.
4. Assessment of impact (e.g., unauthorized data access, privilege escalation, log poisoning).

---

## 3. SLA & Response Timelines

| Severity Level | Initial Acknowledgement | Triage & Remediation Plan | Production Hotfix Target |
|---|---|---|---|
| **Critical (P1)** | < 2 hours | < 12 hours | < 24 hours |
| **High (P2)** | < 6 hours | < 24 hours | < 72 hours |
| **Medium (P3)** | < 24 hours | < 3 business days | < 10 business days |
| **Low (P4)** | < 48 hours | < 5 business days | Next release cycle |

---

## 4. Secret & Credential Governance

- **Zero Hardcoded Secrets**: All API tokens, service account passwords, and database credentials must resolve dynamically via CyberArk CCP or environment variables (`.env` during local dev only).
- **Vault Scoping**: Credentials retrieved via `backend/config/cyberark/credential_provider.js` are cached strictly in-memory with automatic TTL expiration (300s) to prevent memory persistence.
- **Audit Logging**: Any administrative override or authentication failure is recorded immutably in `.runtime/nas_logs/sentinel_audit.log` and database audit tables.
