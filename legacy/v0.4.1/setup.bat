@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================
echo DarkWar Tracker setup
echo ============================================
echo.

set "PYTHON_EXE="
set "PYTHON_ARGS="

rem 1. Prefer Python 3.12 from the Python launcher.
where py >nul 2>nul
if not errorlevel 1 (
    py -3.12 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,12) and sys.version_info < (3,13) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3.12"
        goto :python_found
    )

    rem Python 3.11 is also supported.
    py -3.11 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) and sys.version_info < (3,13) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3.11"
        goto :python_found
    )
)

rem 2. Try python.exe already available on PATH.
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) and sys.version_info < (3,13) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_EXE=python"
        set "PYTHON_ARGS="
        goto :python_found
    )
)

rem 3. Try common per-user installation locations.
for %%P in (
    "%LocalAppData%\Programs\Python\Python312\python.exe"
    "%LocalAppData%\Programs\Python\Python311\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
) do (
    if exist "%%~P" (
        "%%~P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) and sys.version_info < (3,13) else 1)" >nul 2>nul
        if not errorlevel 1 (
            set "PYTHON_EXE=%%~P"
            set "PYTHON_ARGS="
            goto :python_found
        )
    )
)

echo Python 3.11 or 3.12 was not found.
echo.

rem 4. Offer automatic installation through WinGet.
where winget >nul 2>nul
if errorlevel 1 goto :manual_install

echo Python 3.12 can be installed automatically with WinGet.
choice /C YN /N /M "Install Python 3.12 now? [Y/N]: "
if errorlevel 2 goto :manual_install

echo.
echo Installing Python 3.12...
winget install --id Python.Python.3.12 -e --source winget --accept-source-agreements --accept-package-agreements

if errorlevel 1 (
    echo.
    echo WinGet installation failed.
    goto :manual_install
)

rem The current Command Prompt may not receive the new PATH.
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python312\python.exe"
    set "PYTHON_ARGS="
    goto :python_found
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3.12 -c "import sys" >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3.12"
        goto :python_found
    )
)

echo.
echo Python was installed, but this terminal has not refreshed its environment.
echo Close this window and run setup.bat again.
pause
exit /b 0

:manual_install
echo.
echo Install Python 3.12, then run setup.bat again.
echo Recommended command:
echo.
echo   winget install --id Python.Python.3.12 -e --source winget
echo.
echo After installation, close and reopen Command Prompt.
pause
exit /b 1

:python_found
echo Using:
"%PYTHON_EXE%" %PYTHON_ARGS% --version
if errorlevel 1 (
    echo The selected Python runtime could not be started.
    pause
    exit /b 1
)

echo.
if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    "%PYTHON_EXE%" %PYTHON_ARGS% -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
    echo Could not create the Python virtual environment.
    pause
    exit /b 1
)

echo Upgrading pip...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :dependency_error

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :dependency_error

echo Verifying installation...
".venv\Scripts\python.exe" scripts\verify_install.py
if errorlevel 1 (
    echo Installation verification failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo Setup complete.
echo ============================================
echo Next:
echo   1. Install Npcap if it is not installed.
echo   2. Run calibrate_refresh.bat and choose Full Weekly.
echo   3. Run start_darkwar_services.ps1
echo   4. Run start_dashboard.bat
echo   5. For Discord Activity, run setup_discord_activity.bat
echo.
pause
exit /b 0

:dependency_error
echo.
echo Python package installation failed.
echo Check your internet connection, then run setup.bat again.
pause
exit /b 1
