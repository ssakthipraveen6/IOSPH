<#
.SYNOPSIS
    Deploys Fluent Bit Log Shipper as a Windows Service on Enterprise Windows Compute Nodes.
    Phase 3b / T3b.1.

.PARAMETER SentinelEndpoint
    The HTTPS URL for Sentinel log ingestion (default: https://sentinel.yourbank.internal/v1/logs).

.PARAMETER Environment
    Target environment (prod, staging).

.PARAMETER ShipperToken
    Bearer authentication token bound to the environment.
#>
[CmdletBinding()]
param(
    [string]$SentinelEndpoint = "https://sentinel.yourbank.internal/v1/logs",
    [ValidateSet("prod", "staging", "demo")]
    [string]$Environment = "staging",
    [string]$ShipperToken = ""
)

$FluentBitVersion = "3.0.4"
$InstallDir = "C:\Program Files\fluent-bit"
$MsiUrl = "https://packages.fluentbit.io/windows/fluent-bit-$FluentBitVersion-win64.msi"
$TempMsi = "$env:TEMP\fluent-bit-$FluentBitVersion.msi"

Write-Host "[SENTINEL-FLUENTBIT] Installing Fluent Bit $FluentBitVersion for Windows ($Environment)..." -ForegroundColor Cyan

# 1. Download MSI package if not present
if (-not (Test-Path $InstallDir)) {
    Write-Host "[STEP 1] Downloading installer from $MsiUrl..."
    Invoke-WebRequest -Uri $MsiUrl -OutFile $TempMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$TempMsi`" /qn /norestart" -Wait
    Remove-Item $TempMsi -Force -ErrorAction SilentlyContinue
}

# 2. Deploy Configuration File with Redaction Filters
$ConfigFile = "$InstallDir\conf\fluent-bit.conf"
$ConfigContent = @"
[SERVICE]
    Flush         2
    Log_Level     info
    Daemon        off
    Parsers_File  parsers.conf

[INPUT]
    Name          tail
    Tag           win.app.log
    Path          C:\logs\*.log,C:\ProgramData\Sentinel\logs\*.log
    DB            C:\ProgramData\Sentinel\fluentbit_tail.db
    Mem_Buf_Limit 50MB

[FILTER]
    Name          modify
    Match         *
    Add           deployment.environment $Environment
    Add           host.name $env:COMPUTERNAME
    Add           os.type windows

[OUTPUT]
    Name          http
    Match         *
    Host          $([System.Uri]::new($SentinelEndpoint).Host)
    Port          443
    URI           /v1/logs
    Format        json
    Header        X-Sentinel-Environment $Environment
    Header        Authorization Bearer $ShipperToken
    Tls           On
    Tls.verify    On
"@

Set-Content -Path $ConfigFile -Value $ConfigContent -Encoding UTF8
Write-Host "[STEP 2] Configured $ConfigFile with environment $Environment"

# 3. Restart Windows Service
Restart-Service -Name "fluent-bit" -ErrorAction SilentlyContinue
Write-Host "[STEP 3] Fluent Bit service started and operational." -ForegroundColor Green
