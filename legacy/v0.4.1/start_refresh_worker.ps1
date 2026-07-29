$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Run setup.bat first."
    Read-Host "Press Enter to close"
    exit 1
}

& $python -m darkwar_tracker.refresh_worker --config config.toml
