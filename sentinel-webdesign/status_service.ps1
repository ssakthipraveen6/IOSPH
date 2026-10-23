# Shows the state of the ProjectSentinelDaemon scheduled task and calls /api/health on port 3001.
Write-Host "========================================================" -ForegroundColor Green
Write-Host "     Project Sentinel: Service Status Check" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

# 1. Check Scheduled Task
$task = Get-ScheduledTask -TaskName "ProjectSentinelDaemon" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Scheduled Task : Registered" -ForegroundColor Green
    Write-Host "Task State     : $($task.State)" -ForegroundColor Cyan
} else {
    Write-Host "Scheduled Task : Not Registered" -ForegroundColor Yellow
}

# 2. Check Port 3001 Listener
$portConn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($portConn) {
    $procId = $portConn.OwningProcess | Select-Object -First 1
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    Write-Host "Port 3001      : LISTENING (Process: $($proc.ProcessName), PID: $procId)" -ForegroundColor Green
} else {
    Write-Host "Port 3001      : NOT LISTENING" -ForegroundColor Red
}

# 3. Check HTTP Health
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
    Write-Host "API Health     : ONLINE (Score: $($health.score), Status: $($health.status))" -ForegroundColor Green
    Write-Host ""
    Write-Host "Dashboard URL  : http://localhost:3001" -ForegroundColor Cyan
    Write-Host "Demo URL       : http://localhost:3001/?env=demo" -ForegroundColor Cyan
} catch {
    Write-Host "API Health     : UNREACHABLE" -ForegroundColor Red
}
Write-Host "========================================================" -ForegroundColor Green
