@echo off
title deepseek harness - icebreak
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch.ps1" -Action install
if errorlevel 1 (
  echo Installation failed. See the message above.
  pause
  exit /b 1
)
pause
