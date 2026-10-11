# RB-003: Jenkins Automation Circuit Breaker Tripped
**Document ID**: RB-003  
**Severity**: P2 - High  
**Target RTO**: < 15 Minutes  
**Owning Team**: Automation Platform / SRE

---

## 1. Symptoms & Detection
- Alert: `[CIRCUIT BREAKER] Trip: 3 consecutive failures reached. Breaker OPEN.`
- Recovery jobs are skipped; alerts show: `Jenkins Circuit Breaker is OPEN. Recovery blocked for Xs.`
- Incident auto-created in ServiceNow assigned to `sre-oncall-primary`.

---

## 2. Diagnostics
1. Check live circuit breaker state:
   ```bash
   curl -s http://127.0.0.1:3001/api/circuit-breaker/status | jq .
   ```
2. Inspect the failed Jenkins job executions:
   - Login to Jenkins: `https://jenkins.k8s.internal/job/<job-name>`
   - Review console logs for the last 3 failed builds:
     - Check for Kubernetes runner OOM (`exit code 137`)
     - Check for network timeout connecting to target host
     - Check for expired Jenkins API token or service account lock

---

## 3. Resolution & Safe Reset Procedure
1. Resolve the underlying Jenkins cluster or agent issue.
2. Verify a single manual test build runs green in Jenkins.
3. Reset the Circuit Breaker via the Sentinel SRE Dashboard or API:
   ```bash
   curl -X POST http://127.0.0.1:3001/api/circuit-breaker/reset \
     -H "Authorization: Bearer <sre_lead_token>" \
     -H "Content-Type: application/json"
   ```
4. Verify breaker returns to `CLOSED`:
   ```bash
   curl -s http://127.0.0.1:3001/api/circuit-breaker/status
   # Expected: {"state":"CLOSED","consecutiveFailures":0}
   ```
