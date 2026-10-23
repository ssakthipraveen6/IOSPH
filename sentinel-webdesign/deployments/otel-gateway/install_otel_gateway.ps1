# ====================================================================
# Project Sentinel - OpenTelemetry Collector gateway installation
# ====================================================================
# Installs otelcol-contrib.exe as the Windows service "SentinelOtelGateway"
# on a SENTINEL node. Safe to re-run: every step checks before it changes.
#
#   - copies otelcol-contrib.exe from -OtelColPath (no internet download)
#   - copies otel-gateway.yaml to C:\ProgramData\SentinelOtelGateway (old copy backed up)
#   - creates the persistent queue folder ...\queue and grants the service account Modify
#   - sets machine-level env vars ONLY for parameters you pass (no secret is hard-coded)
#   - registers the service: automatic (delayed) start, restart on failure (sc.exe failure)
#   - opens TCP 4317/4318 to -AgentSourceRange only
#
# Example (run as Administrator):
#   .\install_otel_gateway.ps1 -OtelColPath D:\media\otelcol-contrib.exe `
#       -AgentSourceRange 10.20.0.0/16,10.30.0.0/16 `
#       -SentinelAppUrl https://sentinel-observability.internal.corp `
#       -IngestApiKey (Read-Host -AsSecureString 'Ingest key') `
#       -GatewayToken (Read-Host -AsSecureString 'Gateway token')
# ====================================================================
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OtelColPath,

    # Agent subnets allowed to reach 4317/4318, e.g. 10.20.0.0/16. Never defaults to Any.
    [Parameter(Mandatory = $true)]
    [string[]]$AgentSourceRange,

    # Optional: subnets allowed to scrape :8888 (self-metrics) and :13133 (health).
    [string[]]$MonitoringSourceRange = @(),

    [string]$InstallDir = "$env:ProgramFiles\SentinelOtelGateway",
    [string]$DataDir = "$env:ProgramData\SentinelOtelGateway",
    [string]$ConfigSource = (Join-Path $PSScriptRoot 'otel-gateway.yaml'),
    [string]$ServiceName = 'SentinelOtelGateway',
    # Built-in accounts only (no password needed). For a gMSA pass 'DOMAIN\name$'.
    [string]$ServiceAccount = 'NT AUTHORITY\NetworkService',

    # Environment variables: each is written ONLY when supplied.
    [string]$SentinelAppUrl,
    [SecureString]$IngestApiKey,
    [SecureString]$GatewayToken,
    [string]$ClickHouseTcpEndpoint,
    [string]$ClickHouseUser,
    [SecureString]$ClickHousePassword,

    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "[INFO] $msg" -ForegroundColor Yellow }

function ConvertFrom-Secure([SecureString]$s) {
    if (-not $s) { return $null }
    return [System.Net.NetworkCredential]::new('', $s).Password
}

function Set-MachineEnv([string]$Name, [string]$Value, [switch]$Secret) {
    if ([string]::IsNullOrEmpty($Value)) { return }
    $current = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    if ($current -ceq $Value) {
        Write-Ok "$Name already set (unchanged)"
    } else {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Machine')
        if ($Secret) { Write-Ok "$Name set (value hidden)" } else { Write-Ok "$Name = $Value" }
    }
}

Write-Host "========================================================" -ForegroundColor Green
Write-Host "     Project Sentinel: OTel Collector gateway setup" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

# ---- 1. Inputs -----------------------------------------------------------
if (-not (Test-Path -LiteralPath $OtelColPath -PathType Leaf)) { throw "otelcol-contrib.exe not found at '$OtelColPath'." }
if (-not (Test-Path -LiteralPath $ConfigSource -PathType Leaf)) { throw "Gateway config not found at '$ConfigSource'." }
foreach ($r in $AgentSourceRange) {
    if ($r -match '^(any|\*|0\.0\.0\.0/0)$') { throw "Refusing to open 4317/4318 to '$r'. Pass the agent subnets." }
}

$exeTarget    = Join-Path $InstallDir 'otelcol-contrib.exe'
$configTarget = Join-Path $DataDir 'otel-gateway.yaml'
$queueDir     = Join-Path $DataDir 'queue'

# ---- 2. Stop a running instance so the binary can be replaced -------------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Stopped') {
    Write-Step "Stopping existing $ServiceName"
    Stop-Service -Name $ServiceName -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
}

# ---- 3. Binary ---------------------------------------------------------
Write-Step "Installing binary to $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$srcHash = (Get-FileHash -LiteralPath $OtelColPath -Algorithm SHA256).Hash
$dstHash = if (Test-Path -LiteralPath $exeTarget) { (Get-FileHash -LiteralPath $exeTarget -Algorithm SHA256).Hash } else { '' }
if ($srcHash -ne $dstHash) {
    Copy-Item -LiteralPath $OtelColPath -Destination $exeTarget -Force
    Write-Ok "otelcol-contrib.exe copied (SHA256 $srcHash)"
} else {
    Write-Ok "otelcol-contrib.exe already current"
}
try { Write-Note ("Collector version: " + ((& $exeTarget --version) -join ' ')) } catch { Write-Note "Could not read collector version: $($_.Exception.Message)" }

# ---- 4. Config + queue folder -------------------------------------------
Write-Step "Installing config to $DataDir"
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
if (Test-Path -LiteralPath $configTarget) {
    $old = (Get-FileHash -LiteralPath $configTarget -Algorithm SHA256).Hash
    $new = (Get-FileHash -LiteralPath $ConfigSource -Algorithm SHA256).Hash
    if ($old -ne $new) {
        $backup = "$configTarget.$(Get-Date -Format 'yyyyMMddHHmmss').bak"
        Copy-Item -LiteralPath $configTarget -Destination $backup -Force
        Copy-Item -LiteralPath $ConfigSource -Destination $configTarget -Force
        Write-Ok "Config updated (previous saved as $backup)"
    } else {
        Write-Ok "Config already current"
    }
} else {
    Copy-Item -LiteralPath $ConfigSource -Destination $configTarget -Force
    Write-Ok "Config installed"
}

# The service account needs Modify on the queue/data folder only.
& icacls.exe $DataDir /grant "${ServiceAccount}:(OI)(CI)M" /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed granting $ServiceAccount on $DataDir" }
Write-Ok "$ServiceAccount granted Modify on $DataDir"

# ---- 5. Machine-level environment (only what was passed) -----------------
Write-Step "Environment variables (only those supplied)"
Set-MachineEnv 'SENTINEL_APP_URL'        $SentinelAppUrl
Set-MachineEnv 'SENTINEL_INGEST_API_KEY' (ConvertFrom-Secure $IngestApiKey) -Secret
Set-MachineEnv 'SENTINEL_GATEWAY_TOKEN'  (ConvertFrom-Secure $GatewayToken) -Secret
Set-MachineEnv 'CLICKHOUSE_TCP_ENDPOINT' $ClickHouseTcpEndpoint
Set-MachineEnv 'CLICKHOUSE_USER'         $ClickHouseUser
Set-MachineEnv 'CLICKHOUSE_PASSWORD'     (ConvertFrom-Secure $ClickHousePassword) -Secret

$required = 'SENTINEL_APP_URL', 'SENTINEL_INGEST_API_KEY', 'SENTINEL_GATEWAY_TOKEN'
$missing = $required | Where-Object { [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($_, 'Machine')) }
if ($missing) { Write-Note ("Not yet set at machine level: " + ($missing -join ', ') + ". The service will not forward data until they are.") }
if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CLICKHOUSE_TCP_ENDPOINT', 'Machine'))) {
    Write-Note "CLICKHOUSE_TCP_ENDPOINT not set: remove the traces pipeline from the config if you are not storing traces."
}

# ---- 6. Validate the config with the installed binary --------------------
Write-Step "Validating config"
# Variables just written at machine level are not in this process yet; load them for validate.
foreach ($n in 'SENTINEL_APP_URL', 'SENTINEL_INGEST_API_KEY', 'SENTINEL_GATEWAY_TOKEN', 'CLICKHOUSE_TCP_ENDPOINT', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD') {
    Set-Item -Path "Env:$n" -Value ([string][Environment]::GetEnvironmentVariable($n, 'Machine'))
}
& $exeTarget validate "--config=$configTarget" 2>&1 | ForEach-Object { Write-Host "       $_" }
if ($LASTEXITCODE -ne 0) {
    if ($missing) { Write-Note "Validation failed, most likely because of the unset variables above. Re-run once they are supplied." }
    else { throw "otelcol-contrib validate failed for $configTarget" }
} else {
    Write-Ok "Config is valid"
}

# ---- 7. Event log source (the collector logs to it when run as a service) --
foreach ($src in @($ServiceName, 'otelcol-contrib')) {
    if (-not [System.Diagnostics.EventLog]::SourceExists($src)) {
        New-EventLog -LogName Application -Source $src
        Write-Ok "Event log source '$src' created"
    }
}

# ---- 8. Service ----------------------------------------------------------
Write-Step "Registering service $ServiceName"
$binPath = "`"$exeTarget`" --config=`"$configTarget`""
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    New-Service -Name $ServiceName -BinaryPathName $binPath `
        -DisplayName 'Sentinel OpenTelemetry Gateway' `
        -Description 'Project Sentinel OTLP gateway: forwards agent metrics/logs to SENTINEL and traces to ClickHouse.' `
        -StartupType Automatic | Out-Null
    Write-Ok "Service created"
}
# Keep the image path current on re-runs. Written through the registry because Windows
# PowerShell 5.1 mangles embedded quotes when passing them to sc.exe.
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $binPath
# sc.exe needs the space after each '='. Built-in accounts need no password.
& sc.exe config $ServiceName start= delayed-auto obj= $ServiceAccount | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe config failed ($LASTEXITCODE)" }
# Restart after 5s, 15s, then 60s; reset the failure counter after a day.
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failure failed ($LASTEXITCODE)" }
# Also treat a non-zero exit (not just a crash) as a failure.
& sc.exe failureflag $ServiceName 1 | Out-Null
Write-Ok "Delayed automatic start, restart-on-failure configured, running as $ServiceAccount"

# ---- 9. Firewall -----------------------------------------------------------
Write-Step "Firewall"
function Set-GatewayRule([string]$Name, [string]$Display, [string[]]$Ports, [string[]]$Remote) {
    $rule = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
    if ($rule) {
        Set-NetFirewallRule -Name $Name -Enabled True -Action Allow -Direction Inbound
        $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Ports
        $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $Remote
        Write-Ok "Updated rule $Name -> $($Ports -join ',') from $($Remote -join ',')"
    } else {
        New-NetFirewallRule -Name $Name -DisplayName $Display -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $Ports -RemoteAddress $Remote -Profile Domain,Private | Out-Null
        Write-Ok "Created rule $Name -> $($Ports -join ',') from $($Remote -join ',')"
    }
}
Set-GatewayRule 'SentinelOtelGateway-OTLP' 'Sentinel OTel Gateway (OTLP 4317/4318)' @('4317', '4318') $AgentSourceRange
if ($MonitoringSourceRange.Count -gt 0) {
    Set-GatewayRule 'SentinelOtelGateway-Monitoring' 'Sentinel OTel Gateway (health 13133, metrics 8888)' @('13133', '8888') $MonitoringSourceRange
}

# ---- 10. Start + health ----------------------------------------------------
if ($NoStart) {
    Write-Note "-NoStart given: service registered but not started."
} else {
    Write-Step "Starting $ServiceName"
    Start-Service -Name $ServiceName
    $healthy = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri 'http://localhost:13133/' -UseBasicParsing -TimeoutSec 2 | Out-Null
            $healthy = $true; break
        } catch { }
    }
    if ($healthy) { Write-Ok "Health check http://localhost:13133/ is answering" }
    else { Write-Note "Service started but health check not answering yet. See Event Viewer > Application ($ServiceName / otelcol-contrib)." }
}

Write-Host ""
Write-Host "Useful commands:" -ForegroundColor White
Write-Host "  Get-Service $ServiceName"
Write-Host "  Invoke-WebRequest http://localhost:13133/ -UseBasicParsing"
Write-Host "  (Invoke-WebRequest http://localhost:8888/metrics -UseBasicParsing).Content | Select-String otelcol_exporter"
Write-Host "  .\uninstall_otel_gateway.ps1"
Write-Host "========================================================"
