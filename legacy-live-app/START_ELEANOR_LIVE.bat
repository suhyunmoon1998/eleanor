@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from nodejs.org, then run this file again.
  pause
  exit /b 1
)
node launch.mjs
pause
