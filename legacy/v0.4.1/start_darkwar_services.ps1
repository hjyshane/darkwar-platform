$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Run setup.bat first."
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Starting passive packet collector..."
Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSScriptRoot\start_collector.ps1`""
)

Start-Sleep -Seconds 4

Write-Host "Starting idle-aware refresh worker..."
Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSScriptRoot\start_refresh_worker.ps1`""
)

Write-Host ""
Write-Host "Collector and Refresh Worker were started."
Write-Host "Dashboard remains optional: start_dashboard.bat"
