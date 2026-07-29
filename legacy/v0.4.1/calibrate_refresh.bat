@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)

echo Choose refresh workflow:
echo   1. Full Weekly ^(recommended: rankings + my alliance + tracked alliances^)
echo   2. Rankings only
echo   3. My Alliance members only
echo   4. Tracked Alliances members only
set /p CHOICE=Selection [1-4]: 

if "%CHOICE%"=="1" set WORKFLOW=full_weekly_ui
if "%CHOICE%"=="2" set WORKFLOW=rankings
if "%CHOICE%"=="3" set WORKFLOW=my_alliance
if "%CHOICE%"=="4" set WORKFLOW=tracked_alliances

if "%WORKFLOW%"=="" (
  echo Invalid selection.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" ".\scripts\calibrate_refresh.py" --config config.toml --workflow %WORKFLOW%
if errorlevel 1 pause
endlocal
