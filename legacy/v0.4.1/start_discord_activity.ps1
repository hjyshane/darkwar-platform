param(
    [string]$Config = "config.toml"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "Python environment not found. Run setup.bat first."
}

$envFile = Join-Path $PSScriptRoot ".env.activity"
if (-not (Test-Path $envFile)) {
    throw ".env.activity not found. Run setup_discord_activity.bat first."
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Count -eq 2) {
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}

if ($env:DISCORD_CLIENT_ID -match "^YOUR_" -or $env:DISCORD_CLIENT_SECRET -match "^YOUR_") {
    throw "Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env.activity."
}

$env:DARKWAR_CONFIG = (Resolve-Path $Config).Path
& $python -m darkwar_tracker.activity_api --config $Config
