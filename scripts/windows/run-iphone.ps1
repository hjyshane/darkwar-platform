# Run the iPhone collection chain in the foreground (for trying it by hand).
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI.
#
# dw-iphone is the whole chain in one process: it captures every plugged-in
# iPhone, runs ingest-dir and dw-sync as its own children, and starts the game
# on each phone. To have it start at logon instead, register-iphone-task.ps1.
#
# Needs pymobiledevice3 on PATH (uv tool install pymobiledevice3), Apple
# Devices or iTunes installed, and Developer Mode on the phone. Settings come
# from DW_ENV_FILE or C:\DW_data\.env; the phone chain has its OWN journal
# (C:\DW_data\iphone.db), not the BlueStacks one.

[CmdletBinding()]
param(
    [string]$Collector = ''
)

$ErrorActionPreference = 'Stop'
# Resolved here, not as the parameter default: Windows PowerShell 5.1 leaves
# $PSScriptRoot empty while parameter defaults are evaluated.
if (-not $Collector) {
    $Collector = (Resolve-Path (Join-Path $PSScriptRoot '..\..\services\collector')).Path
}

# --no-sync: `uv run` re-syncing the environment rewrites console scripts that
# a running process holds open (see register-tasks.ps1).
Write-Host 'dw-iphone running. Ctrl+C to stop.'
& uv run --no-sync --project $Collector python -m dw_collector.iphone
