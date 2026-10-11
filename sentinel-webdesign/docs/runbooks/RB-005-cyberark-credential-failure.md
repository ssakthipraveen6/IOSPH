# RB-005: CyberArk CCP Credential Retrieval Failure
**Document ID**: RB-005  
**Severity**: P1 - Critical (Security Bootstrapping)  
**Target RTO**: < 15 Minutes  
**Owning Team**: DevSecOps / Identity & Access Management (IAM)

---

## 1. Symptoms & Detection
- Sentinel service fails to boot: `[FATAL] JWT bootstrap failed at startup: CyberArk CCP HTTP 403 / 500`.
- Scrapers log: `[CRED] Failed applying credential for <target>: No credential resolved from CyberArk`.
- Authentication audit events log `CYBERARK_CCP_TIMEOUT`.

---

## 2. Immediate Diagnostic Triage
1. Test CyberArk Central Credential Provider (AIMWebService) health:
   ```powershell
   $ccpUrl = "https://cyberark-ccp.internal.corp/AIMWebService/api/Accounts?AppID=SentinelObservability&Safe=APP-SENTINEL-PROD&Object=jwt-signing-key"
   Invoke-RestMethod -Uri $ccpUrl -CertificateThumbprint "<ClientCertThumbprint>"
   ```
2. Common Root Causes:
   - **Client Certificate Expired**: Sentinel uses mutual TLS (mTLS) to authenticate to CCP.
   - **IP Not Whitelisted**: The host Windows Server IP must be allowed in the CyberArk AppID definition.
   - **Object Name Mismatch**: The safe or object name in `global_config.yaml` does not match the vault.

---

## 3. Temporary Recovery & Emergency Key Rotation
If CyberArk CCP is undergoing enterprise maintenance:
1. Contact IAM On-Call to verify CCP agent availability.
2. In disaster scenarios, inject temporary rotating secret into machine environment:
   ```powershell
   [System.Environment]::SetEnvironmentVariable("JWT_SECRET_EMERGENCY", "<secure_random_key>", "Machine")
   Restart-Service -Name "SentinelObservability"
   ```
3. Once CyberArk recovers, revoke emergency secret and return to CCP dynamic fetch.
