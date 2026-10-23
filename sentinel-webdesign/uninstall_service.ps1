# Stops and removes the ProjectSentinelDaemon scheduled task created by install_service.ps1.
# Auto-elevate to Administrator if not already elevated
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ELEVATION REQUIRED] Launching with Administrator privileges..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File "$PSCommandPath"") -Verb RunAs
    Exit
}

$taskName = "ProjectSentinelDaemon"
Write-Host "Stopping and removing Project Sentinel background service..." -ForegroundColor Yellow

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Terminate any lingering node server on port 3001
$portConn = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($portConn) {
    $pids = $portConn | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pidToKill in $pids) {
        Write-Host "Terminating process PID $pidToKill on port 3001..." -ForegroundColor Yellow
        Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Project Sentinel background service has been completely uninstalled." -ForegroundColor Green
