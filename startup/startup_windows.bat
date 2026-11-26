@echo off
setlocal enabledelayedexpansion

REM AQA NEA note: Windows startup helper for local/lab deployment.
set ROOT_DIR=%~dp0..
set BACKEND_DIR=%ROOT_DIR%\backend
set FRONTEND_DIR=%ROOT_DIR%\frontend

where python >nul 2>nul
if errorlevel 1 (
  echo python is required.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required.
  exit /b 1
)

cd /d "%BACKEND_DIR%"
if not exist ".venv" (
  python -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m app.migration_runner

REM Start backend in a separate terminal window.
REM Use python -m to avoid stale venv console-script launcher paths.
start "AMS Backend" cmd /k "cd /d %BACKEND_DIR% && call .venv\Scripts\activate.bat && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

cd /d "%FRONTEND_DIR%"
npm install
npm run tauri:build

set APP_EXE=%FRONTEND_DIR%\src-tauri\target\release\ams-desktop.exe
if exist "%APP_EXE%" (
  echo Build complete: %APP_EXE%
  start "" "%APP_EXE%"
) else (
  echo Build complete. Check installer under:
  echo %FRONTEND_DIR%\src-tauri\target\release\bundle\
)

endlocal
