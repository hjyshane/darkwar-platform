@echo off
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a .pcapng file onto this batch file.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m darkwar_tracker.offline "%~1"
pause
