@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" -m darkwar_tracker.refresh_worker --config config.toml --status
pause
