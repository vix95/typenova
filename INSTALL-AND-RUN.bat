@echo off
setlocal
cd /d "%~dp0"
title TypeNova - Install and Run
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1"
if errorlevel 1 (
  echo.
  echo Setup or launch failed. Read the message above.
  pause
)
endlocal
