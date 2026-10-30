@echo off
title XT-AIGC Platform - One Click Start
cd /d "%~dp0"

echo ============================================================
echo        XT-AIGC Video Storyboard AI Creation Platform
echo ------------------------------------------------------------
echo   Frontend: http://localhost:5173   (Vite dev server)
echo   Backend:  http://localhost:3001   (Express API server)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18+ first.
  pause
  exit /b 1
)

REM ---------- Install dependencies on first run ----------
if not exist "server\node_modules" (
  echo [INIT] Installing backend dependencies...
  pushd server
  call npm install
  popd
)
if not exist "client\node_modules" (
  echo [INIT] Installing frontend dependencies...
  pushd client
  call npm install
  popd
)

REM ---------- Detect already-running services ----------
REM Backend: if port 3001 is listening, skip starting it.
netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul 2>&1
if errorlevel 1 goto backend_start
curl.exe -s -o nul http://localhost:3001/health
if errorlevel 1 goto backend_start
echo [SKIP  ] Backend already running and healthy on port 3001.
set WAIT_BACKEND=0
goto check_frontend

:backend_start
echo [START ] Backend API server on port 3001 ...
start "XT-Backend :3001" cmd /k "cd /d %~dp0server && npm run dev"
set WAIT_BACKEND=1

REM Frontend: if port 5173 is listening, skip starting it.
:check_frontend
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if errorlevel 1 goto frontend_start
echo [SKIP  ] Frontend already running on port 5173.
set WAIT_FRONTEND=0
goto wait_backend

:frontend_start
echo [START ] Frontend dev server on port 5173 ...
start "XT-Frontend :5173" cmd /k "cd /d %~dp0client && npm run dev"
set WAIT_FRONTEND=1

REM ---------- Wait for backend health (only if we just started it) ----------
:wait_backend
if "%WAIT_BACKEND%"=="0" goto wait_frontend
echo [WAIT  ] Polling backend health at /health ...
set /a tries=0
:backend_poll
curl.exe -s -o nul http://localhost:3001/health
if errorlevel 1 goto backend_retry
echo [READY ] Backend is up.
goto wait_frontend
:backend_retry
set /a tries+=1
if %tries% geq 20 goto backend_timeout
ping -n 3 127.0.0.1 >nul
goto backend_poll
:backend_timeout
echo [WARN  ] Backend not ready within 40s. Check the "XT-Backend :3001" window.

REM ---------- Wait for frontend port (only if we just started it) ----------
:wait_frontend
if "%WAIT_FRONTEND%"=="0" goto open_browser
echo [WAIT  ] Waiting for frontend on port 5173 ...
set /a ftries=0
:frontend_poll
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if errorlevel 1 goto frontend_retry
echo [READY ] Frontend is up.
goto open_browser
:frontend_retry
set /a ftries+=1
if %ftries% geq 10 goto open_browser
ping -n 3 127.0.0.1 >nul
goto frontend_poll

:open_browser
echo [OPEN  ] http://localhost:5173
start "" http://localhost:5173
echo.
echo ============================================================
echo   Platform ready!
echo   - Already-running services are kept as-is; only missing
echo     ones are started in separate windows.
echo   - To restart a service: close its window, then re-run
echo     this script.
echo ============================================================
pause
exit /b 0
