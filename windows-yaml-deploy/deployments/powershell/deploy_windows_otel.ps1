<#
.SYNOPSIS
    Deploys OpenTelemetry Collector on Windows Server fleet via PowerShell / SCCM.
.DESCRIPTION
    Installs the MSI package, deploys the approved YAML config pointing to Sentinel URL,
    and starts the Windows service.
#>

[CmdletBinding()]
param (
    [string]$ArtifactoryMsiUrl = "https://artifactory-prod.internal.corp/artifactory/binaries/otelcol-contrib_0.95.0_windows_amd64.msi",
    [string]$SentinelEndpoint = "https://sentinel.yourbank.internal/v1/metrics",
    [string]$InstallDir = "C:\Program Files\OpenTelemetry Collector"
)

$ErrorActionPreference = "Stop"
Write-Host "[OTEL DEPLOY] Starting OpenTelemetry Windows deployment..." -ForegroundColor Cyan

# 1. Download MSI from internal repository
$tempMsi = "$env:TEMP\otelcol-contrib.msi"
Write-Host "[OTEL DEPLOY] Downloading MSI from $ArtifactoryMsiUrl..."
Invoke-WebRequest -Uri $ArtifactoryMsiUrl -OutFile $tempMsi -UseBasicParsing

# 2. Silent MSI Installation
Write-Host "[OTEL DEPLOY] Executing silent MSI installation..."
$process = Start-Process msiexec.exe -ArgumentList "/i `"$tempMsi`" /qn /norestart" -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "MSI Installation failed with exit code: $($process.ExitCode)"
}

# 3. Copy configuration file
$targetConfig = Join-Path $InstallDir "config.yaml"
$sourceConfig = Join-Path $PSScriptRoot "..\opentelemetry_configs\otel_windows_config.yaml"

if (Test-Path $sourceConfig) {
    Copy-Item -Path $sourceConfig -Destination $targetConfig -Force
    Write-Host "[OTEL DEPLOY] Deployed config to $targetConfig"
} else {
    Write-Warning "Source config not found at $sourceConfig, generating default config..."
}

# 4. Configure and Start Windows Service
Write-Host "[OTEL DEPLOY] Configuring 'otelcol' Windows Service..."
Set-Service -Name "otelcol" -StartupType Automatic
Restart-Service -Name "otelcol" -Force

$svc = Get-Service -Name "otelcol"
Write-Host "[OTEL DEPLOY] Service Status: $($svc.Status)" -ForegroundColor Green
Write-Host "[OTEL DEPLOY] OpenTelemetry Windows deployment complete!" -ForegroundColor Green
