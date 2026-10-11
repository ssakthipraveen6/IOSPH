@echo off
title Starting Project Sentinel in Background...
wscript.exe start_background.vbs
echo.
echo ========================================================
echo   Project Sentinel has been launched in the background!
echo   Available at: http://localhost:3001
echo   Demo URL:     http://localhost:3001/?env=demo
echo ========================================================
echo.
ping 127.0.0.1 -n 3 >nul
