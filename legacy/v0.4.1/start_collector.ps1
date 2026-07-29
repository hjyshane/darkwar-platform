$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Start-Process powershell.exe `
        -Verb RunAs `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$PSCommandPath`""
        )
    exit
}

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "Run setup.bat first."
    Read-Host "Press Enter to close"
    exit 1
}

& $python -m darkwar_tracker.collector --config config.toml

Write-Host ""
Read-Host "Collector stopped. Press Enter to close"
