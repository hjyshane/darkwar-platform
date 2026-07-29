$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$activity = Join-Path $PSScriptRoot "start_discord_activity.ps1"
$tunnel = Join-Path $PSScriptRoot "start_activity_tunnel.ps1"

Start-Process powershell.exe -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$activity`""
)
Start-Sleep -Seconds 3
Start-Process powershell.exe -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$tunnel`""
)
