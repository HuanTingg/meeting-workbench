@echo off
setlocal
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 goto failed
if not exist "node_modules\typescript\package.json" (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
if not exist "node_modules\mysql2\package.json" (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-funasr.ps1"
node scripts/launch.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Node.js 22 or newer is required. See errors above.
pause
exit /b 1
