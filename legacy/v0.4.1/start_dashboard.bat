@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m darkwar_tracker.migrate --config config.toml
if errorlevel 1 (
    echo Database migration failed.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m streamlit run darkwar_tracker\dashboard.py
