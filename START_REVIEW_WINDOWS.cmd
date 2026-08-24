@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or later is required.
  echo Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js is too old. Install Node.js 22.13 or later.
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\next\package.json" (
  echo Installing packages. This can take several minutes the first time.
  call npm install
  if errorlevel 1 goto :error
)

set "NEXT_PUBLIC_CAMPUS_LOCAL_PREVIEW=true"
echo.
echo Starting Manabi Memo with local CMTR preview.
echo Open http://localhost:3000 in your browser.
echo To stop, press Ctrl+C in this window.
echo.
call npm run dev
exit /b %errorlevel%

:error
echo Startup failed. Keep this window open and save the last 20 lines.
pause
exit /b 1
