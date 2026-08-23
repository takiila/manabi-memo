@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install Node.js 22.13 or later, then run this file again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if errorlevel 1 (
  echo.
  echo Your Node.js version is too old.
  echo Install Node.js 22.13 or later, then run this file again.
  echo Current version:
  node --version
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\next\package.json" (
  echo.
  echo Installing required packages. This may take several minutes.
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Keep this window open and take a screenshot
    echo of the error shown above.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting Manabi Memo.
echo Open http://localhost:3000 in your browser after startup completes.
echo To stop the server, press Ctrl+C in this window.
echo.
call npm run dev

echo.
pause
