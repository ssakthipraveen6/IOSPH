<#
.SYNOPSIS
  Project Sentinel Windows Service Deployment Helper
  Forwards execution to the canonical installation script located at the repository root.
#>
$RootScript = Resolve-Path (Join-Path $PSScriptRoot "..\..\install_service.ps1")
if (Test-Path $RootScript) {
    Write-Host "[INFO] Delegating to canonical Windows service installer: $RootScript" -ForegroundColor Cyan
    & $RootScript @args
} else {
    Write-Error "[ERROR] Canonical install_service.ps1 not found at repo root ($RootScript)."
}
