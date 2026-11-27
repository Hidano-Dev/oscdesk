@echo off
cd /d "%~dp0"
title oscdesk

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell not found.
  pause
  exit /b 1
)

REM The launcher scripts live in launchers\. Missing dependencies or build outputs
REM are set up automatically before starting. Only the bridge runs; it serves the UI.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launchers\start-oscdesk.ps1" %*
set "OSCDESK_EXIT=%ERRORLEVEL%"

echo.
pause
exit /b %OSCDESK_EXIT%
