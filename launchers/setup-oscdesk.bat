@echo off
cd /d "%~dp0.."
title oscdesk setup
REM Normally not needed: start-oscdesk.bat runs setup automatically when something is missing.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-oscdesk.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_EXIT%
