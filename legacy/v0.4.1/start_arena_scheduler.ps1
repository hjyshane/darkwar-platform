$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "The daily arena-only scheduler was replaced in v0.3.0."
Write-Host "Starting the idle-aware Refresh Worker instead."
& "$PSScriptRoot\start_refresh_worker.ps1"
