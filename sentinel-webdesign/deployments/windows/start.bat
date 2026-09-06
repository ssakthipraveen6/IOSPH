@echo off
:: =======================================================================
:: Project Sentinel - Windows Deployment Launcher (Forwarder)
:: Executes canonical start.bat from the repository root.
:: =======================================================================
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%..\.."
call start.bat %*
popd
