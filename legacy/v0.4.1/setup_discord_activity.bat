@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20.19 or newer is required.
  echo Install the current Node.js LTS release, then run this file again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>20 || (v[0]===20 && v[1]>=19) ? 0 : 1)"
if errorlevel 1 (
  echo [ERROR] Node.js 20.19 or newer is required.
  node --version
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Python environment not found. Run setup.bat first.
  exit /b 1
)

echo [1/4] Installing Python Activity dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt --upgrade
if errorlevel 1 exit /b 1

echo [2/4] Installing Discord Activity frontend dependencies...
pushd activity\client
call npm install
if errorlevel 1 (
  popd
  exit /b 1
)

echo [3/4] Building Discord Activity frontend...
call npm run build
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo [4/4] Adding config section if needed...
".venv\Scripts\python.exe" scripts\add_discord_activity_config.py --config config.toml
if errorlevel 1 exit /b 1

if not exist ".env.activity" (
  copy /y activity_env.example .env.activity >nul
  echo Created .env.activity from template.
)

echo.
echo Discord Activity build complete.
echo Edit config.toml and .env.activity, then run start_discord_activity.ps1.
endlocal
