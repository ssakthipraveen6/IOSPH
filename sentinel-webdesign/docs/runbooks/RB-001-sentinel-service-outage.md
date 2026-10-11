# RB-001: Sentinel Primary Service Outage
**Document ID**: RB-001  
**Severity**: P1 - Critical  
**Target RTO**: < 5 Minutes  
**Target RPO**: 0 Minutes (In-memory buffer drains to Postgres)  
**Owning Team**: Core Platform SRE Team (`@sentinel/platform-sre`)

---

## 1. Symptoms & Detection
- AVI Load Balancer marks the pool member down (`GET /api/healthz` fails or times out > 5s).
- RefWeb / IIS displays `502 Bad Gateway` or `503 Service Unavailable`.
- Telemetry agents (OTel Collector / Dynatrace) report buffer accumulation and connection resets on port 3001.

---

## 2. Immediate Diagnostic Triage (< 2 Minutes)
Connect to the host Windows Server via PAM / CyberArk Privileged Session:

```powershell
# 1. Check if the Node.js process is active
Get-Process -Name "node" -ErrorAction SilentlyContinue

# 2. Check Windows Service status
Get-Service -Name "SentinelObservability"

# 3. Test internal HTTP health directly bypassing AVI / IIS
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/healthz" -TimeoutSec 3
```

---

## 3. Resolution Steps

### Scenario A: Service Stopped / Crashed
Restart the Windows daemon with proper credentials:
```powershell
Restart-Service -Name "SentinelObservability" -Force
Get-Service -Name "SentinelObservability"
```
Verify port binding:
```powershell
netstat -ano | findstr 3001
```

### Scenario B: Process Deadlocked / High Memory
If the process is stuck or consuming > 2GB RAM:
```powershell
# Capture mini thread-dump if diagnostic tooling is active
# Force kill stuck PID
Stop-Process -Name "node" -Force
Start-Service -Name "SentinelObservability"
```

### Scenario C: IIS / HttpPlatformHandler Bridge Failure
If Node is running on 3001 but external requests fail:
```powershell
iisreset /restart
```

---

## 4. Verification & Health Check
1. Query health endpoint:
   ```powershell
   (Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/healthz").status
   # Expected output: "UP"
   ```
2. Verify AVI Load Balancer virtual service status transitions to Green.
3. Open the Sentinel Web Dashboard and check the **Live** badge.

---

## 5. Escalation Path
- Primary: Lead SRE On-Call (`+91-98xxxxxx01`)
- Secondary: Platform Infrastructure Lead (`+91-98xxxxxx02`)
- Tertiary: Head of DevSecOps (`+91-98xxxxxx03`)
