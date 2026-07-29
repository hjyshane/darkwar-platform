$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    exit 1
}

function Test-ModuleRunning([string]$ModuleName) {
    $needle = "-m $ModuleName"
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
        if ($process.CommandLine -and $process.CommandLine.Contains($needle)) {
            return $true
        }
    }
    return $false
}

if (-not (Test-ModuleRunning "darkwar_tracker.collector")) {
    Start-Process $python `
        -ArgumentList @("-m", "darkwar_tracker.collector", "--config", "config.toml") `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden
}

Start-Sleep -Seconds 3

if (-not (Test-ModuleRunning "darkwar_tracker.refresh_worker")) {
    Start-Process $python `
        -ArgumentList @("-m", "darkwar_tracker.refresh_worker", "--config", "config.toml") `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden
}
