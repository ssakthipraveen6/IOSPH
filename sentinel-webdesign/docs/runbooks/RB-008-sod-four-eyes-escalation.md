# RB-008: Stalled Four-Eyes Approval & SOD Escalation
**Document ID**: RB-008  
**Severity**: P2 - High  
**Target RTO**: < 10 Minutes  
**Owning Team**: SRE On-Call / Incident Commander

---

## 1. Trigger & Condition
- An automated remediation workflow requiring dual approval (Four-Eyes / Segregation of Duties) is in `Pending Approval` state for more than 15 minutes during an active P1/P2 outage.
- The workflow will automatically time out and cancel after 2 hours.

---

## 2. SOD Governance Rules
- **Rule 1**: The user who triggered the runbook (or the system service account if automated) **CANNOT** approve the action.
- **Rule 2**: Approver must hold the `SRE Lead` or `Super Admin` RBAC role.
- **Rule 3**: Approvals are bound to the specific `runId` and cryptographically signed with the approver's AD identity.

---

## 3. Escalation Procedure
1. Identify the pending runbook and who initiated it:
   ```bash
   curl -s http://127.0.0.1:3001/api/recovery | jq '[.[] | select(.status=="Pending Approval")]'
   ```
2. Locate a qualified secondary approver:
   - Check the active on-call rotation in PagerDuty / ServiceNow Rota.
   - Contact secondary SRE via incident bridge / Slack `#sre-incidents`.
3. Execute approval from the second user's authenticated session:
   - In Sentinel Web UI: Click **Approve Runbook** in the SRE Center.
   - Or via CLI:
     ```bash
     curl -X POST http://127.0.0.1:3001/api/recovery/approve \
       -H "Authorization: Bearer <approver_token>" \
       -H "Content-Type: application/json" \
       -d '{"runId": "REC-XXXXX"}'
     ```
4. If self-approval is attempted, the API will return HTTP `403 Forbidden` (`ERR_SOD_SELF_APPROVAL`).
