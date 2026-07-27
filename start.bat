@echo off
title Project Sentinel - Observability Portal Setup
echo =======================================================
echo     Project Sentinel: Autonomous Observability Portal
echo              Native Windows Server Hosting
echo =======================================================
echo.

:: Check Node.js installation
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not added to your system PATH.
    echo Please install Node.js (version 20 or higher) and try again.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [INFO] First run detected. Installing backend dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install backend dependencies.
        pause
        exit /b 1
      )
)

if exist "frontend\dist\index.html" (
    echo [INFO] Pre-compiled frontend assets found. Skipping installation and compile steps.
    goto :start_server
)

if not exist "frontend\node_modules\" (
    echo [INFO] Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install frontend dependencies.
        pause
        exit /b 1
    )
)

:: Compile the React Production build
echo.
echo [INFO] Compiling production frontend bundle...
call npm run build-frontend
if %errorlevel% neq 0 (
    echo [ERROR] Failed to compile React frontend bundle.
    pause
    exit /b 1
)

:start_server
:: Start the application
echo.
echo [INFO] Starting observability daemon server...
echo [INFO] Project Sentinel will be available at http://localhost:3001
echo.
call npm run start
if %errorlevel% neq 0 (
    echo [ERROR] Observability daemon stopped unexpectedly.
    pause
    exit /b 1
)
