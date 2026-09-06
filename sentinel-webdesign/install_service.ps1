# ====================================================================
# Project Sentinel - Windows Server Background Service Installation
# ====================================================================
# This PowerShell script registers Project Sentinel as a background 
# task that starts automatically when Windows Server boots.
# Run this script as Administrator.
# ====================================================================

# Ensure execution context is Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script requires Administrator permissions. Please run PowerShell as Administrator."
    Exit
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$batFile = Join-Path -Path $scriptPath -ChildPath "start.bat"

Write-Host "========================================================" -ForegroundColor Green
Write-Host "     Project Sentinel: Background Service Setup" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "Configuring Project Sentinel to run natively on startup..."
Write-Host "Target Executable: $batFile"
Write-Host.

# Option A: Register as a Native Scheduled Task triggered at System Boot (Recommended & Native)
$taskName = "ProjectSentinelDaemon"
$taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($taskExists) {
    Write-Host "[INFO] Scheduled Task '$taskName' already exists. Re-creating task to sync path..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Define scheduled task parameters
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batFile`"" -WorkingDirectory $scriptPath
$trigger = New-ScheduledTaskTrigger -AtStartup
# Run as SYSTEM user to ensure it starts without active user logins and has adequate rights
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Setup settings (e.g. restart task if it fails, don't stop if it runs longer than 3 days)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $taskName -InputObject $task | Out-Null

Write-Host "[SUCCESS] Scheduled Task registered successfully!" -ForegroundColor Green
Write-Host "Project Sentinel will now start automatically at boot (running in the background as SYSTEM)."
Write-Host "You can manually trigger it now by running: Start-ScheduledTask -TaskName '$taskName'"
Write-Host.

# Option B: NSSM Instructions (Non-Sucking Service Manager)
Write-Host "--------------------------------------------------------"
Write-Host "Alternative: True NT Service Installation via NSSM"
Write-Host "--------------------------------------------------------"
Write-Host "If your corporate security policy requires a native Windows NT Service (visible in services.msc):"
Write-Host "1. Download NSSM from https://nssm.cc"
Write-Host "2. From an elevated command prompt, run:"
Write-Host "   nssm install ProjectSentinel `"$batFile`""
Write-Host "3. Start the service:"
Write-Host "   Start-Service ProjectSentinel"
Write-Host "========================================================"
