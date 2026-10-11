# RB-002: SLO Error Budget Depletion & Deployment Freeze
**Document ID**: RB-002  
**Severity**: P2 - High  
**Target RTO**: < 30 Minutes (Governance Enforcement)  
**Owning Team**: SRE Governance & Release Engineering

---

## 1. Trigger & Condition
- The 30-day rolling error budget for any Tier-1 service (`sentinel_api_availability` or `autonomous_recovery_success_rate`) hits `0%` or enters `BUDGET_EXHAUSTED`.
- Current burn-rate exceeds $5.0\times$ critical threshold over a 6-hour rolling window.

---

## 2. Immediate Governance Actions
1. **Automated Deployment Freeze Notification**:
   - The SRE dashboard will display a prominent red **Deployment Freeze Active** banner.
   - Bitbucket pipeline merge checks must reject non-emergency production promotions.
2. **Alert On-Call Release Manager**:
   - Verify if any active deployments or canary rollouts triggered the burn.

---

## 3. Investigation & Root Cause Triage
1. Check `/api/slo/status`:
   ```bash
   curl -s http://127.0.0.1:3001/api/slo/status | jq .
   ```
2. Identify which specific SLI failed:
   - If `sentinel_api_availability`: Inspect 5xx errors in IIS log:
     ```powershell
     Get-Content C:\inetpub\logs\LogFiles\W3SVC1\*.log -Tail 50 | Select-String " 500 "
     ```
   - If `autonomous_recovery_success_rate`: Inspect failed recovery runs in database:
     ```bash
     curl -s http://127.0.0.1:3001/api/recovery | jq '[.[] | select(.status=="Failed")]'
     ```

---

## 4. Policy Override & Exception Protocol
If an emergency production hotfix is required during an active deployment freeze:
1. Raise an **Emergency CAB (eCAB)** ticket in ServiceNow.
2. Secure dual-signature approval from:
   - Head of Engineering / Delivery Manager
   - Head of SRE / Production Governance
3. Attach ticket ID to git commit tag: `[ECAB-XXXXX-OVERRIDE]`.
