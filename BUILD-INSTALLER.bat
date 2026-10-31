@echo off
setlocal
cd /d "%~dp0"
title TypeNova - Build Windows Installer
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1" -BuildInstaller
if errorlevel 1 (
  echo.
  echo The installer build failed. Read the message above.
  pause
)
endlocal
