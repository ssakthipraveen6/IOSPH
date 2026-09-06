# Windows Server Deployment Architecture

This directory provides operational helpers and reference configurations for deploying Project Sentinel to **Windows Server** (IIS 10.0+ / Native Windows Services).

## Canonical Scripts
For operational consistency, the canonical executable scripts reside at the repository root:
- [`/start.bat`](../../start.bat) — Interactive dev/staging runtime bootstrap and build launcher.
- [`/install_service.ps1`](../../install_service.ps1) — Production Windows Service registration (`ProjectSentinelObservability`) via NSSM or WinSW.
- [`/web.config`](../../web.config) — IIS HttpPlatformHandler reverse-proxy routing configuration.

The forwarder scripts in this directory (`start.bat` and `install_service.ps1`) automatically delegate to the root canonical files.
