# ====================================================================
# Project Sentinel - OpenTelemetry Collector gateway removal
# ====================================================================
# Stops and deletes the SentinelOtelGateway service and its firewall rules.
# Safe to re-run. By default KEEPS the queue/config folder (it may hold
# undelivered telemetry), the binary and the machine environment variables.
#
#   .\uninstall_otel_gateway.ps1                     service + firewall only
#   .\uninstall_otel_gateway.ps1 -RemoveBinary -RemoveData -RemoveEnvironment
# ====================================================================
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$ServiceName = 'SentinelOtelGateway',
    [string]$InstallDir = "$env:ProgramFiles\SentinelOtelGateway",
    [string]$DataDir = "$env:ProgramData\SentinelOtelGateway",
    [switch]$RemoveBinary,
    # Deletes config AND the persistent queue (any telemetry not yet delivered is lost).
    [switch]$RemoveData,
    [switch]$RemoveEnvironment
)

$ErrorActionPreference = 'Stop'
function Write-Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "[INFO] $msg" -ForegroundColor Yellow }

Write-Host "========================================================" -ForegroundColor Green
Write-Host "     Project Sentinel: OTel Collector gateway removal" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
        Write-Ok "Service stopped"
    }
    & sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe delete failed ($LASTEXITCODE)" }
    Write-Ok "Service $ServiceName deleted"
} else {
    Write-Note "Service $ServiceName not present"
}

foreach ($rule in 'SentinelOtelGateway-OTLP', 'SentinelOtelGateway-Monitoring') {
    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -Name $rule
        Write-Ok "Firewall rule $rule removed"
    }
}

if ($RemoveBinary) {
    if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force; Write-Ok "Removed $InstallDir" }
} else {
    Write-Note "Binary kept in $InstallDir (use -RemoveBinary)"
}

if ($RemoveData) {
    if (Test-Path -LiteralPath $DataDir) { Remove-Item -LiteralPath $DataDir -Recurse -Force; Write-Ok "Removed $DataDir (config + queue)" }
} else {
    Write-Note "Config and persistent queue kept in $DataDir (use -RemoveData)"
}

if ($RemoveEnvironment) {
    foreach ($n in 'SENTINEL_APP_URL', 'SENTINEL_INGEST_API_KEY', 'SENTINEL_GATEWAY_TOKEN',
                   'CLICKHOUSE_TCP_ENDPOINT', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD') {
        if ($null -ne [Environment]::GetEnvironmentVariable($n, 'Machine')) {
            [Environment]::SetEnvironmentVariable($n, $null, 'Machine')
            Write-Ok "Machine env var $n removed"
        }
    }
    Write-Note "CLICKHOUSE_* may also be used by the SENTINEL app on this host; re-set them if so."
} else {
    Write-Note "Machine environment variables kept (use -RemoveEnvironment)"
}
Write-Host "========================================================"
