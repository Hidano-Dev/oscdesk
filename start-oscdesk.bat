@echo off
cd /d "%~dp0"
title oscdesk

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell not found.
  pause
  exit /b 1
)

REM The launcher scripts live in launchers\. Missing dependencies, build outputs
REM or the Python venv are set up automatically before starting.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launchers\start-oscdesk.ps1" %*
set "OSCDESK_EXIT=%ERRORLEVEL%"

echo.
pause
exit /b %OSCDESK_EXIT%
