@echo off
echo Stopping Project Sentinel service and background processes...
powershell -Command "Stop-ScheduledTask -TaskName 'ProjectSentinelDaemon' -ErrorAction SilentlyContinue"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do (
    echo Terminating PID %%a on port 3001...
    taskkill /F /PID %%a >nul 2>&1
)
echo Project Sentinel stopped.
