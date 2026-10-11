# RB-007: ServiceNow ITSM Integration Dispatch Failure
**Document ID**: RB-007  
**Severity**: P2 - High  
**Target RTO**: < 30 Minutes  
**Owning Team**: IT Service Management (ITSM) / Enterprise Tooling

---

## 1. Symptoms & Detection
- Alert: `[SERVICENOW] Incident creation failed for recovery REC-XXXXX: HTTP 401 / 503`.
- Autonomous recovery succeeds in Jenkins, but no corresponding `INC` ticket appears on the NOC board.
- Operator audits show unlinked runbook executions.

---

## 2. Immediate Diagnostic Triage
1. Test ServiceNow Table API connectivity:
   ```bash
   curl -s -u "$SN_USER:$SN_PASS" \
     "https://enterprise.service-now.com/api/now/table/incident?sysparm_limit=1"
   ```
2. Common Failure Causes:
   - **Service Account Locked / Password Expired**: ServiceNow integration user account expired.
   - **Mandatory Field Constraint**: A new required field was added to the ServiceNow `incident` table schema (e.g., `u_cmdb_ci_mandatory`).
   - **Mid-Server Down**: In on-premise hybrid setups, check the corporate MID server connectivity.

---

## 3. Resolution
1. Verify credentials in CyberArk or update service user configuration.
2. In disaster situations, Sentinel queues unresolved ticket creations in the event store. Run the reconciliation script:
   ```bash
   node tools/reconcile_snow_tickets.js --env=prod
   ```
3. Verify new tickets appear in the Sentinel ServiceNow panel.
