$ErrorActionPreference = "Stop"

Write-Host "Installing Python 3.12 with WinGet..."

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "WinGet was not found."
    Write-Host "Install Python 3.12 manually, then run setup.bat again."
    Read-Host "Press Enter to close"
    exit 1
}

winget install `
    --id Python.Python.3.12 `
    -e `
    --source winget `
    --accept-source-agreements `
    --accept-package-agreements

Write-Host ""
Write-Host "Installation command finished."
Write-Host "Close this window, reopen the project folder, and run setup.bat."
Read-Host "Press Enter to close"
