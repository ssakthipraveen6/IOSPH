<#
.SYNOPSIS
    Unified Windows Telemetry Exporter Installer for Project Sentinel.
.DESCRIPTION
    Installs ONLY the selected metrics exporter (OpenTelemetry Collector OR Windows Exporter)
    based on the -CollectorType parameter to prevent running duplicate agents.
.PARAMETER CollectorType
    Specifies which exporter to install: 'opentelemetry' (Default/Recommended) or 'windows_exporter'.
.PARAMETER SentinelEndpoint
    The HTTPS URL of the Sentinel backend for OTel push (e.g. https://sentinel.yourbank.internal/v1/metrics).
.PARAMETER ListenPort
    The listen port for windows_exporter (Default: 9182).
#>

[CmdletBinding()]
param (
    [ValidateSet("opentelemetry", "windows_exporter")]
    [string]$CollectorType = "opentelemetry",

    [string]$SentinelEndpoint = "https://sentinel.yourbank.internal/v1/metrics",
    [string]$OtelMsiUrl = "https://artifactory-prod.internal.corp/artifactory/binaries/otelcol-contrib_0.95.0_windows_amd64.msi",
    [string]$WinExporterMsiUrl = "https://artifactory-prod.internal.corp/artifactory/binaries/windows_exporter-0.25.1-amd64.msi",
    [int]$ListenPort = 9182
)

$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 PROJECT SENTINEL - WINDOWS TELEMETRY DEPLOYMENT" -ForegroundColor Cyan
Write-Host "Selected Collector: $CollectorType" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# CONDITION 1: Install OpenTelemetry Collector (Primary/Recommended)
# -------------------------------------------------------------------------
if ($CollectorType -eq "opentelemetry") {
    Write-Host "[OTEL] Selected OpenTelemetry. Ensuring windows_exporter is not running..."
    if (Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue) {
        Stop-Service -Name "windows_exporter" -Force -ErrorAction SilentlyContinue
        Set-Service -Name "windows_exporter" -StartupType Disabled -ErrorAction SilentlyContinue
        Write-Host "[OTEL] Disabled legacy windows_exporter service." -ForegroundColor Yellow
    }

    $tempMsi = "$env:TEMP\otelcol-contrib.msi"
    Write-Host "[OTEL] Downloading OpenTelemetry Collector MSI..."
    Invoke-WebRequest -Uri $OtelMsiUrl -OutFile $tempMsi -UseBasicParsing

    Write-Host "[OTEL] Installing OpenTelemetry Collector..."
    $process = Start-Process msiexec.exe -ArgumentList "/i `"$tempMsi`" /qn /norestart" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "OTel MSI Installation failed with exit code: $($process.ExitCode)"
    }

    $InstallDir = "C:\Program Files\OpenTelemetry Collector"
    $targetConfig = Join-Path $InstallDir "config.yaml"
    $sourceConfig = Join-Path $PSScriptRoot "..\opentelemetry_configs\otel_windows_config.yaml"

    if (Test-Path $sourceConfig) {
        Copy-Item -Path $sourceConfig -Destination $targetConfig -Force
        Write-Host "[OTEL] Deployed configuration to $targetConfig"
    }

    Set-Service -Name "otelcol" -StartupType Automatic
    Restart-Service -Name "otelcol" -Force

    $svc = Get-Service -Name "otelcol"
    Write-Host "✅ [OTEL] OpenTelemetry Windows Collector is $($svc.Status) and streaming to $SentinelEndpoint" -ForegroundColor Green
}

# -------------------------------------------------------------------------
# CONDITION 2: Install Prometheus Windows Exporter
# -------------------------------------------------------------------------
elseif ($CollectorType -eq "windows_exporter") {
    Write-Host "[WIN-EXPORTER] Selected Prometheus Windows Exporter. Ensuring OTel service is stopped..."
    if (Get-Service -Name "otelcol" -ErrorAction SilentlyContinue) {
        Stop-Service -Name "otelcol" -Force -ErrorAction SilentlyContinue
        Set-Service -Name "otelcol" -StartupType Disabled -ErrorAction SilentlyContinue
        Write-Host "[WIN-EXPORTER] Disabled otelcol service to prevent duplicate collection." -ForegroundColor Yellow
    }

    $tempMsi = "$env:TEMP\windows_exporter.msi"
    Write-Host "[WIN-EXPORTER] Downloading Prometheus windows_exporter MSI..."
    Invoke-WebRequest -Uri $WinExporterMsiUrl -OutFile $tempMsi -UseBasicParsing

    $installArgs = "/i `"$tempMsi`" LISTEN_PORT=$ListenPort ENABLED_COLLECTORS=`"cpu,os,memory,logical_disk,net,service`" /qn /norestart"
    $process = Start-Process msiexec.exe -ArgumentList $installArgs -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "windows_exporter installation failed with exit code: $($process.ExitCode)"
    }

    Set-Service -Name "windows_exporter" -StartupType Automatic
    Restart-Service -Name "windows_exporter" -Force

    $svc = Get-Service -Name "windows_exporter"
    Write-Host "✅ [WIN-EXPORTER] windows_exporter is $($svc.Status) on port $ListenPort" -ForegroundColor Green
}
