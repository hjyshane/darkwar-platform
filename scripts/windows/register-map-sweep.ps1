# Register the task that sweeps the cluster's maps every few hours.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI, so
# non-ASCII here does not merely display wrong - it can break the parser.
#
# WHAT IT RUNS: `dw-ui-worker goto-sweep`, which types server, X and Y into the
# game's own "World" box for 70 spots a server and reads back from the journal
# where each jump landed (services/collector/src/dw_collector/ui_worker/goto.py).
#
# WHY THIS ONE MAY REPEAT when register-cold-start.ps1 insists its task must
# not. The cold start taps fixed coordinates on whatever is showing; repeated
# on an unwatched machine it would tap them forever. The sweep looks before
# every tap - the World window, its Go button and Android's text bar are each
# matched against a template first - and ends the run, screenshot saved, on any
# screen it does not recognise. It also stands down while the operator is
# using the emulator, for the :58 macro, and when the kill switch file exists.
#
#   .\scripts\windows\register-map-sweep.ps1
#   .\scripts\windows\register-map-sweep.ps1 -Servers '566-588' -Hours 8 -Start '01:05'
#
# A jump measured 11.2s on 2026-11-18, so the whole cluster (1,610 jumps) is
# about 5 hours, 5.5 with the :55-:00 stand-downs. -Hours must stay above that,
# and the task's time limit is one hour under it, or runs pile up behind
# IgnoreNew.

[CmdletBinding()]
param(
    [string]$Servers    = '566-588',
    [int]$Hours         = 8,
    # First run of the day, local time. Off the hour on purpose: the macro owns
    # :55-:00 and the sweep stands down for it anyway.
    [string]$Start      = '01:05',
    # The scanning window's title, for a second scanning account. Empty means
    # the window titled "collector".
    [string]$Window     = '',
    [string]$LogDir     = 'C:\DW_data\logs',
    [string]$ScriptDir  = 'C:\DW_data',
    [string]$Collector  = 'C:\darkwar-platform\services\collector'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'FAIL: run this from an elevated PowerShell (registering tasks needs it).'
    exit 1
}
if ($Servers -notmatch '^[0-9,\- ]+$') {
    Write-Output ('FAIL: -Servers takes ranges like 566-588 or 580,581 - got ' + $Servers)
    exit 1
}
if ($Hours -lt 2) {
    Write-Output 'FAIL: -Hours under 2 cannot fit a sweep of even a few servers.'
    exit 1
}
if ($Window -and ($Window -notmatch '^[A-Za-z0-9_-]+$')) {
    Write-Output ('FAIL: -Window must be a plain title, got ' + $Window)
    exit 1
}

# Written by register-tasks.ps1; required rather than re-written, as in
# register-cold-start.ps1.
$launcher = Join-Path $ScriptDir 'run-hidden.vbs'
if (-not (Test-Path $launcher)) {
    Write-Output ('FAIL: ' + $launcher + ' is missing.')
    Write-Output '      run scripts\windows\register-tasks.ps1 first - it writes the launcher.'
    exit 1
}

$uv = (Get-Command uv).Source
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$suffix      = if ($Window) { '-' + $Window } else { '' }
$name        = 'DarkWar-MapSweep' + $suffix
$log         = Join-Path $LogDir ('map-sweep' + $suffix + '.log')
$script      = Join-Path $ScriptDir ('run-MapSweep' + $suffix + '.cmd')
$instanceArg = if ($Window) { ' --instance ' + $Window } else { '' }

# --no-sync for the reason register-tasks.ps1 documents: `uv run` re-syncs the
# environment and the always-on tasks hold .venv\Scripts open.
$body = @(
    '@echo off'
    'chcp 65001 >nul'
    'set PYTHONIOENCODING=utf-8'
    'set PYTHONUNBUFFERED=1'
    ('echo [%date% %time%] map sweep ' + $Servers + ' >> "' + $log + '"')
    ('cd /d "' + $Collector + '"')
    ('"' + $uv + '" run --no-sync dw-ui-worker' + $instanceArg + ' goto-sweep --servers ' + $Servers +
        ' >> "' + $log + '" 2>&1')
)
[IO.File]::WriteAllLines($script, $body, [Text.UTF8Encoding]::new($false))

Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

# Repetition assigned as an object: PowerShell 5.1 silently drops
# -RepetitionInterval when no duration is given (register-tasks.ps1).
$first = [datetime]::ParseExact($Start, 'HH:mm', $null)
if ($first -lt (Get-Date)) { $first = $first.AddDays(1) }
$trigger = New-ScheduledTaskTrigger -Once -At $first
$trigger.Repetition = (
    New-ScheduledTaskTrigger -Once -At $first `
        -RepetitionInterval (New-TimeSpan -Hours $Hours) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
).Repetition

# A ceiling one hour under the interval, so a wedged run is gone before the
# next one is due, and IgnoreNew so a slow one is never doubled.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours ($Hours - 1)) `
    -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
    -Argument ('//B //Nologo "' + $launcher + '" "' + $script + '"') `
    -WorkingDirectory $Collector

try {
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Settings $settings -Description ('Dark War map sweep ' + $Servers + ' every ' + $Hours + 'h') `
        -ErrorAction Stop | Out-Null
} catch {
    Write-Output ('FAIL ' + $name + ' : ' + $_.Exception.Message)
    exit 1
}

Write-Output ''
Write-Output '--- check ---'
$registered = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $registered) {
    Write-Output ('FAIL ' + $name + ' : not registered')
    exit 1
}
$repeat = $registered.Triggers | ForEach-Object { $_.Repetition.Interval } | Where-Object { $_ }
if ($repeat -ne ('PT' + $Hours + 'H')) {
    Write-Output ('FAIL ' + $name + ' : repetition is "' + $repeat + '", wanted PT' + $Hours + 'H')
    exit 1
}
if ($registered.Actions[0].Execute -notmatch 'wscript') {
    Write-Output ('FAIL ' + $name + ' : window not hidden')
    exit 1
}
Write-Output ('OK   ' + $name + ' : from ' + $first.ToString('yyyy-MM-dd HH:mm') + ' every ' + $Hours + 'h')
Write-Output ('     script  ' + $script)
Write-Output ('     log     ' + $log)
Write-Output ''
Write-Output ('Not started. To run one now:  Start-ScheduledTask -TaskName ' + $name)
