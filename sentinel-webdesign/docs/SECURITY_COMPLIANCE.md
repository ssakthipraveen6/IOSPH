# 🛡️ Project Sentinel — Regulatory Compliance & Security Addendum
**Standard Compliance**: PCI-DSS v4.0, RBI Master Direction on IT Governance, SEBI Cyber Security Framework  
**Classification**: Enterprise Confidential (BFSI)  
**Last Review**: October 2026

---

## 1. Regulatory Governance Alignment

Project Sentinel operates in production environments within major financial institutions (BFSI). The framework enforces strict controls aligned with central bank and regulatory requirements:

| Regulatory Body / Standard | Mandatory Requirement | Sentinel Implementation Control |
|:---|:---|:---|
| **PCI-DSS v4.0 (Req 10)** | Maintain audit trails of all system components and administrator activities; ensure logs cannot be altered. | Write-once append-only event store with sequential cryptographic HMAC-SHA256 hash chaining (`database/event_store.js`). |
| **PCI-DSS v4.0 (Req 8)** | Secure authentication and credentials management. No hardcoded or plaintext passwords. | Dynamic runtime credential resolution via CyberArk Central Credential Provider (CCP) over mutual TLS. |
| **RBI IT Governance (Sec 6)** | Segregation of Duties (SOD) and dual-control for automated or privileged operations affecting production systems. | Strict Four-Eyes dual approval enforced cryptographically in `remediation/recovery.js`. Self-approval blocked with `ERR_SOD_SELF_APPROVAL`. |
| **RBI Cybersecurity Framework** | Real-time monitoring, anomalous traffic detection, and automated containment. | Streaming $Z$-score statistical outlier detection ($|Z| \ge 3.0\sigma$) and Jenkins circuit breaker safety guards. |
| **SEBI Cyber Resilience** | System uptime monitoring, P95 latency tracking, and formal incident documentation. | Service Level Objectives defined in `config/slos.yaml`, auto-dispatched ServiceNow incident tracking. |

---

## 2. Secrets Management & CyberArk CCP Architecture

```
  ┌────────────────────────┐                   ┌────────────────────────┐
  │  Sentinel Application  │                   │  CyberArk CCP Vault    │
  │  (Windows Server Node) │                   │  (AIMWebService)       │
  └───────────┬────────────┘                   └───────────┬────────────┘
              │                                            │
              │  1. HTTPS GET with mTLS Client Cert       │
              ├───────────────────────────────────────────►│
              │     AppID=SentinelObservability            │
              │     Safe=APP-SENTINEL-PROD                 │
              │                                            │
              │  2. Returns JSON (Secret in RAM only)      │
              │◄───────────────────────────────────────────┤
              │                                            │
              ▼                                            ▼
     Ephemeral In-Memory                         No local .env storage
     Session / Encryption                        Zero credential drift
```

### Key Security Properties
1. **Zero Filesystem Secrets**: Production `.env` files contain no plaintext secrets.
2. **IP Whitelisting & AppID Binding**: Requests from unauthorized source IPs are dropped by the CCP gateway.
3. **Automatic Rotation**: Tokens and database passwords rotate in CyberArk without requiring application restarts.

---

## 3. Cryptographic Audit Trail (HMAC-SHA256 Chain)

Each audit entry forms a verifiable linked block:
$$H_n = \text{HMAC-SHA256}(H_{n-1} \parallel \text{Timestamp} \parallel \text{Actor} \parallel \text{Action} \parallel \text{Payload})$$

```
  ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
  │  Audit Event #1  │       │  Audit Event #2  │       │  Audit Event #3  │
  │  Hash: a1b2...   ├──────►│  Prev: a1b2...   ├──────►│  Prev: c3d4...   │
  │                  │       │  Hash: c3d4...   │       │  Hash: e5f6...   │
  └──────────────────┘       └──────────────────┘       └──────────────────┘
```

If any historical record is deleted, inserted, or modified in PostgreSQL, the entire subsequent chain fails validation, triggering an immediate security alert to the SOC.
