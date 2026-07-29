param(
    [switch]$NoTunnel
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Starting DarkWar collector and idle-aware worker..."
& "$PSScriptRoot\start_darkwar_services.ps1"
Start-Sleep -Seconds 3

Write-Host "Starting Discord Activity API..."
Start-Process powershell.exe -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSScriptRoot\start_discord_activity.ps1`""
)

if (-not $NoTunnel) {
    Start-Sleep -Seconds 3
    Write-Host "Starting temporary Activity HTTPS tunnel..."
    Start-Process powershell.exe -ArgumentList @(
        "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSScriptRoot\start_activity_tunnel.ps1`""
    )
}

Write-Host "DarkWar Discord Command Center processes were started."
