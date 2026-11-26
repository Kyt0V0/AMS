@echo off
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 "%~dp0scripts\start.py" %*
) else (
    python "%~dp0scripts\start.py" %*
)
if errorlevel 1 pause
