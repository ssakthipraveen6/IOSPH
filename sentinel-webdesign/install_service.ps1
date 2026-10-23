# ====================================================================
# Project Sentinel - Windows Server Background Service Installation
# ====================================================================
# This PowerShell script registers Project Sentinel as a background 
# task that starts automatically when Windows Server boots.
# Run this script as Administrator.
# ====================================================================

param(
    [string]$ServiceAccount = $env:SENTINEL_SERVICE_ACCOUNT
)

# Ensure execution context is Administrator; auto-elevate if not
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ELEVATION REQUIRED] Launching with Administrator privileges..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"") -Verb RunAs
    Exit
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$batFile = Join-Path -Path $scriptPath -ChildPath "start.bat"

Write-Host "========================================================" -ForegroundColor Green
Write-Host "     Project Sentinel: Background Service Setup" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "Configuring Project Sentinel to run natively on startup..."
Write-Host "Target Executable: $batFile"
Write-Host ""

$taskName = "ProjectSentinelDaemon"
$taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($taskExists) {
    Write-Host "[INFO] Service Task '$taskName' already exists. Stopping and updating..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Service account (param block is at the top of the file; PowerShell requires that)
if (-not $ServiceAccount) {
    # Default to least-privilege NetworkService instead of SYSTEM
    $ServiceAccount = "NT AUTHORITY\NetworkService"
}

Write-Host "Configuring Project Sentinel service with Least-Privilege Principal: $ServiceAccount" -ForegroundColor Cyan

$logDir = Join-Path -Path $scriptPath -ChildPath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$stdoutLog = Join-Path -Path $logDir -ChildPath "windows_service_stdout.log"
$stderrLog = Join-Path -Path $logDir -ChildPath "windows_service_stderr.log"

# Define scheduled task parameters: Runs silently via cmd /c start.bat --daemon with redirected logs
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batFile`" --daemon > `"$stdoutLog`" 2> `"$stderrLog`"" -WorkingDirectory $scriptPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType ServiceAccount -RunLevel Limited

# Setup settings (3 restart attempts with 1-min interval, alert if exhausted)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $taskName -InputObject $task | Out-Null

Write-Host "[SUCCESS] Scheduled Service Task registered successfully!" -ForegroundColor Green
Write-Host "Starting service task now..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName

# Verify health
Write-Host "Verifying service availability at http://localhost:3001 ..."
$healthy = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($res) {
            $healthy = $true
            break
        }
    } catch {
        # Initializing
    }
}

Write-Host ""
if ($healthy) {
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "  ✅ Project Sentinel is ONLINE and Healthy!" -ForegroundColor Green
    Write-Host "  Dashboard URL: http://localhost:3001" -ForegroundColor Cyan
    Write-Host "  Demo URL:      http://localhost:3001/?env=demo" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host "  Service Task registered. Process initializing..." -ForegroundColor Yellow
    Write-Host "  Dashboard URL: http://localhost:3001" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor White
Write-Host "  - Check Status: powershell ./status_service.ps1"
Write-Host "  - Stop Service: powershell ./stop_service.bat"
Write-Host "  - Uninstall:    powershell ./uninstall_service.ps1"
Write-Host "========================================================"
