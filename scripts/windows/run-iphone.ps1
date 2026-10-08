# Run the iPhone collection chain in the foreground: capture -> ingest -> sync.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI.
#
# For a phone that lives at home and is plugged in when you want fresh data.
# Plug it in, unlock it once and tap Trust, then run this. Closing the window
# or pressing Ctrl+C stops all three. Unplugging is fine: dw-iphone waits and
# picks up again when the phone comes back, restarting the game on reconnect.
#
# Needs: pymobiledevice3 on PATH (uv tool install pymobiledevice3), Apple
# Devices or iTunes installed, Developer Mode on, and SUPABASE_URL /
# SUPABASE_SECRET_KEY / DW_SQLITE_PATH from the repo .env.
#
# This does NOT replace the always-on tasks from register-tasks.ps1. It uses
# its own capture directory so the two never read each other's files; if both
# write the same journal, point them at the same DW_SQLITE_PATH on purpose.

[CmdletBinding()]
param(
    [string]$Collector = (Resolve-Path (Join-Path $PSScriptRoot '..\..\services\collector')).Path,
    [string]$CaptureDir = 'C:\DW_data\iphone',
    [string]$LogDir = 'C:\DW_data\logs',
    [int]$CollectedFromServer = 580
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $CaptureDir, $LogDir | Out-Null
$env:DW_IPHONE_DIR = $CaptureDir

function Start-Part([string]$Name, [string[]]$UvArgs) {
    $argv = @('run', '--project', $Collector) + $UvArgs
    Start-Process uv -ArgumentList $argv -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir "$Name.out") `
        -RedirectStandardError (Join-Path $LogDir "$Name.err")
}

function Stop-Tree([int]$ProcessId) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" |
        ForEach-Object { Stop-Tree $_.ProcessId }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$parts = @(
    (Start-Part 'iphone-capture' @('dw-iphone')),
    (Start-Part 'iphone-ingest' @(
        'dw-collector', 'ingest-dir', '--dir', $CaptureDir, '--delete-ingested',
        '--interval-seconds', '10', '--min-age-seconds', '5',
        '--collected-from-server', $CollectedFromServer)),
    (Start-Part 'iphone-sync' @('dw-sync'))
)

Write-Host "Running. Logs in $LogDir (iphone-*.out / .err). Ctrl+C to stop."
try {
    while ($true) {
        foreach ($p in $parts) {
            if ($p.HasExited) {
                Write-Warning "process $($p.Id) exited with code $($p.ExitCode); see $LogDir"
            }
        }
        Start-Sleep -Seconds 30
    }
}
finally {
    # Only the processes THIS script started, and what they spawned: uv runs
    # the real python as a child. Matching on command lines instead would kill
    # the always-on dw-sync and ingest-dir tasks too.
    foreach ($p in $parts) { Stop-Tree $p.Id }
}
