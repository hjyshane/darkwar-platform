# Register the task that gets the game running again after a power cut.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI, so
# non-ASCII here does not merely display wrong - it can break the parser.
#
# WHY THIS IS NOT IN register-tasks.ps1, which registers the other four.
#
# Those four are long-running processes, and they are kept alive by a
# 5-minute repetition trigger on the at-logon trigger: a dead one is revived
# by the next repeat. That is exactly the wrong shape here. This task TAPS
# COORDINATES. Run every five minutes it would tap them on whatever the game
# happens to be showing - forever, on a machine nobody is watching. So this
# task runs ONCE at logon and never repeats, and register-tasks.ps1's own
# check loop insists every task it manages HAS a repetition. Two opposite
# rules, kept in two files rather than one file with an exception in it.
#
# WHAT MAKES IT RUN AFTER A POWER CUT. Three things, and only one of them is
# in this script:
#
#   1. BIOS: "Restore on AC Power Loss" = Power On. Without it the machine
#      simply stays off. Nothing in software can fix that.
#   2. Windows auto-logon (netplwiz, or Sysinternals Autologon). Every task
#      here triggers AT LOGON, because BlueStacks and Npcap capture both need
#      a desktop session. No logon, no collection - which is what actually
#      happened: the machine came back and sat at the lock screen.
#   3. This task, which opens the game and clears the way for the routines.
#
#   .\scripts\windows\register-cold-start.ps1 -Routine 'C:\DW_data\routines\cold-start.json'
#
# The routine is device data and is NOT in the repo; `services/collector/
# routines/example-cold-start.json` is the template to copy and fill in. This
# script refuses to register a routine that still holds the template's
# placeholder package, because a cold start that taps zeros is worse than no
# cold start: it reports success.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Routine,
    [string]$BlueStacks = 'C:\Program Files\BlueStacks_nxt\HD-Player.exe',
    # The BlueStacks instance to start. Shown in the Multi-instance Manager;
    # 'Pie64' and 'Nougat64' are the usual names. Not guessed from the running
    # process, because guessing here starts the wrong emulator.
    [string]$Instance   = 'Pie64',
    [string]$LogDir     = 'C:\DW_data\logs',
    [string]$ScriptDir  = 'C:\DW_data',
    [string]$Collector  = 'C:\darkwar-platform\services\collector',
    # How long to wait for the emulator's serial to appear before giving up.
    # A cold boot needs a minute or two; five is past any reasonable start-up
    # and short enough that a failure is reported the same morning.
    [int]$WaitSeconds   = 300
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'FAIL: run this from an elevated PowerShell (registering tasks needs it).'
    exit 1
}

if (-not (Test-Path $Routine)) {
    Write-Output ('FAIL: routine not found at ' + $Routine)
    Write-Output '      copy services/collector/routines/example-cold-start.json and fill it in.'
    exit 1
}
if (-not (Test-Path $BlueStacks)) {
    Write-Output ('FAIL: BlueStacks not found at ' + $BlueStacks + ' - pass -BlueStacks')
    exit 1
}

# Refuse the template. The example ships with a placeholder package and zeroed
# coordinates so that an unconfigured routine aborts on its first step; that
# safety only holds while nobody registers the example itself and assumes the
# machine is covered.
$plan = Get-Content $Routine -Raw | ConvertFrom-Json
$placeholder = $plan.steps | Where-Object { $_.package -eq 'com.example.replace.me' }
if ($placeholder) {
    Write-Output 'FAIL: this routine still has the example package name in it.'
    Write-Output '      find the real one with:  adb shell pm list packages'
    exit 1
}
$launch = $plan.steps | Where-Object { $_.action -eq 'launch' }
if (-not $launch) {
    Write-Output 'FAIL: a cold-start routine with no launch step opens nothing.'
    exit 1
}

# Written by register-tasks.ps1. Required rather than re-written here: two
# copies of the same launcher is two things to fix when it is wrong, and the
# other script's version is the one its four tasks already depend on.
$launcher = Join-Path $ScriptDir 'run-hidden.vbs'
if (-not (Test-Path $launcher)) {
    Write-Output ('FAIL: ' + $launcher + ' is missing.')
    Write-Output '      run scripts\windows\register-tasks.ps1 first - it writes the launcher.'
    exit 1
}

$uv = (Get-Command uv).Source
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ScriptDir | Out-Null

$name   = 'DarkWar-ColdStart'
$log    = Join-Path $LogDir 'cold-start.log'
$script = Join-Path $ScriptDir 'run-ColdStart.cmd'

# --no-sync for the reason register-tasks.ps1 documents at length: `uv run`
# re-syncs the environment, syncing rewrites .venv\Scripts, and dw-sync is
# holding dw-sync.exe open - so a syncing task in this project directory dies
# on os error 32 before doing any work.
#
# `start ""` on the BlueStacks line so cmd does not wait for the emulator to
# EXIT. Without the empty title argument cmd reads the quoted path as the
# window title and starts nothing at all, which is a 20-year-old trap and
# still the most common way this line is written wrong.
$body = @(
    '@echo off'
    'chcp 65001 >nul'
    'set PYTHONIOENCODING=utf-8'
    ('echo [%date% %time%] cold start >> "' + $log + '"')
    ('start "" "' + $BlueStacks + '" --instance ' + $Instance)
    ('cd /d "' + $Collector + '"')
    ('"' + $uv + '" run --no-sync dw-ui-worker run --routine "' + $Routine +
        '" --wait-for-device-seconds ' + $WaitSeconds + ' >> "' + $log + '" 2>&1')
)
[IO.File]::WriteAllLines($script, $body, [Text.UTF8Encoding]::new($false))

Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

# NO repetition, and an hour's ceiling rather than none.
#
# The four collection tasks are meant to run forever and are revived by a
# repeat. This one has a beginning and an end: it opens the game, clears the
# popups, and stops. If it wedges, an hour is long enough for the slowest cold
# boot and short enough that it is gone before the daily routine wants the
# screen. A stuck instance holding the emulator would be invisible otherwise.
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
    -Argument ('//B //Nologo "' + $launcher + '" "' + $script + '"') `
    -WorkingDirectory $Collector

try {
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Settings $settings -Description 'Dark War cold start after a reboot' `
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
if ($repeat) {
    # The inverse of register-tasks.ps1's check, and not a copy-paste error.
    Write-Output ('FAIL ' + $name + ' : has a repetition trigger - it would tap the game every interval')
    exit 1
}
if ($registered.Actions[0].Execute -notmatch 'wscript') {
    Write-Output ('FAIL ' + $name + ' : window not hidden')
    exit 1
}
Write-Output ('OK   ' + $name + ' : at logon, once, no repeat')
Write-Output ('     script  ' + $script)
Write-Output ('     log     ' + $log)

# NOT started here, deliberately. Starting it now would open the game and tap
# coordinates while somebody is sitting at the machine - and the first thing
# to establish about a new routine is whether those coordinates are right.
Write-Output ''
Write-Output 'Not started. Check the routine first, without touching the emulator:'
Write-Output ('  uv run dw-ui-worker run --routine "' + $Routine + '" --dry-run')
Write-Output 'Then let it run for real by logging off and on, and read the log above.'
