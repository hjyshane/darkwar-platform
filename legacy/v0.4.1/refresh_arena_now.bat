@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" ".\scripts\queue_refresh.py" arena --config config.toml --priority 1
".venv\Scripts\python.exe" -m darkwar_tracker.refresh_worker --config config.toml --once --verbose
echo.
echo The request remains queued if Windows is not idle.
pause
