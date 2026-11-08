@echo off
title deepseek harness - icebreak
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch.ps1" -Action uninstall
if errorlevel 1 (
  echo Uninstallation failed. See the message above.
  pause
  exit /b 1
)
pause
