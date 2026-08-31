<#
.SYNOPSIS
    Deploys Prometheus windows_exporter on Windows Server fleet.
#>

[CmdletBinding()]
param (
    [string]$ArtifactoryMsiUrl = "https://artifactory-prod.internal.corp/artifactory/binaries/windows_exporter-0.25.1-amd64.msi",
    [int]$ListenPort = 9182
)

$ErrorActionPreference = "Stop"
Write-Host "[WIN-EXPORTER] Installing Prometheus windows_exporter on port $ListenPort..." -ForegroundColor Cyan

$tempMsi = "$env:TEMP\windows_exporter.msi"
Invoke-WebRequest -Uri $ArtifactoryMsiUrl -OutFile $tempMsi -UseBasicParsing

$installArgs = "/i `"$tempMsi`" LISTEN_PORT=$ListenPort ENABLED_COLLECTORS=`"cpu,os,memory,logical_disk,net,service`" /qn /norestart"
$process = Start-Process msiexec.exe -ArgumentList $installArgs -Wait -PassThru

if ($process.ExitCode -ne 0) {
    throw "windows_exporter installation failed with exit code: $($process.ExitCode)"
}

Set-Service -Name "windows_exporter" -StartupType Automatic
Restart-Service -Name "windows_exporter" -Force

Write-Host "[WIN-EXPORTER] windows_exporter installed and running on port $ListenPort" -ForegroundColor Green
