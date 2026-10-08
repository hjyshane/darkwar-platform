# Register DarkWar-iPhone: start dw-iphone at logon and keep it running.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI.
#
#   .\scripts\windows\register-iphone-task.ps1
#   .\scripts\windows\register-iphone-task.ps1 -Collector 'C:\darkwar-platform\services\collector' -Start
#
# One task, because dw-iphone is the whole chain (capture, ingest, sync). It
# follows register-tasks.ps1's shape: at logon, a 5-minute repetition that
# only ever revives a dead one (MultipleInstances IgnoreNew), no window
# (wscript), and a log file.
#
# Registered for the CURRENT user and run as that user, so it needs no
# password and, normally, no elevation. If registration is denied, run this
# from an elevated PowerShell.
#
# -Collector is where the code is run FROM. The always-on tasks run from the
# main checkout (C:\darkwar-platform); a worktree is deleted one day, and a
# task pointing into it then fails at every logon.

[CmdletBinding()]
param(
    [string]$Collector = 'C:\darkwar-platform\services\collector',
    [string]$ScriptDir = 'C:\DW_data',
    [string]$LogDir = 'C:\DW_data\logs',
    # Where dw-iphone keeps chunks and its journal. Empty means its default
    # (C:\DW_data); set it to try the task out without touching real data.
    [string]$DataDir = '',
    [string]$TaskName = 'DarkWar-iPhone',
    [switch]$Start
)

$ErrorActionPreference = 'Stop'

# Registering a task is denied to a non-elevated shell on this machine
# (Register-ScheduledTask: Access is denied), and that error is
# non-terminating: without this check the script went on to print
# "registered" and "started" for a task that did not exist.
$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'FAIL: run this from an elevated PowerShell (registering tasks needs it).'
    exit 1
}

if (-not (Test-Path (Join-Path $Collector 'src\dw_collector\iphone\__main__.py'))) {
    Write-Output ('FAIL: ' + $Collector + ' has no dw_collector\iphone. Pull main there first:')
    Write-Output '      git -C C:\darkwar-platform pull'
    exit 1
}
if (-not (Get-Command pymobiledevice3 -ErrorAction SilentlyContinue)) {
    Write-Output 'FAIL: pymobiledevice3 is not on PATH. Run: uv tool install pymobiledevice3'
    exit 1
}
$uv = (Get-Command uv).Source
New-Item -ItemType Directory -Force -Path $ScriptDir, $LogDir | Out-Null

# Reuse the hidden launcher register-tasks.ps1 writes, if it is there. It
# returns the child's exit code, which is what makes a failing task legible.
$launcher = Join-Path $ScriptDir 'run-hidden.vbs'
if (-not (Test-Path $launcher)) {
    $vbs = @(
        'Option Explicit'
        'Dim shell, code'
        'If WScript.Arguments.Count < 1 Then WScript.Quit 2'
        'Set shell = CreateObject("WScript.Shell")'
        'code = shell.Run(WScript.Arguments(0), 0, True)'
        'WScript.Quit code'
    )
    [IO.File]::WriteAllLines($launcher, $vbs, [Text.UTF8Encoding]::new($false))
}

# cmd's >> and not PowerShell's *>>: PowerShell 5.1 writes UTF-16.
# pymobiledevice3 is a uv tool, installed under ~\.local\bin; the task does
# not get an interactive PATH, so that directory is added by hand.
$cmd = Join-Path $ScriptDir ('run-' + $TaskName + '.cmd')
$log = Join-Path $LogDir 'iphone.log'
$body = @(
    '@echo off'
    'chcp 65001 >nul'
    'set PYTHONIOENCODING=utf-8'
    ('set PATH=%USERPROFILE%\.local\bin;%PATH%')
    ('cd /d "' + $Collector + '"')
    ('"' + $uv + '" run --no-sync python -m dw_collector.iphone >> "' + $log + '" 2>&1')
)
if ($DataDir) { $body = $body[0..2] + ('set DW_DATA_DIR=' + $DataDir) + $body[3..($body.Count - 1)] }
[IO.File]::WriteAllLines($cmd, $body, [Text.UTF8Encoding]::new($false))

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

# Repetition assigned as an object: PowerShell 5.1 silently drops
# -RepetitionInterval here (see register-tasks.ps1).
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (
    New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
).Repetition

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
    -Argument ('//B //Nologo "' + $launcher + '" "' + $cmd + '"') `
    -WorkingDirectory $Collector

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
Write-Output ('registered ' + $TaskName + ' for ' + $user)
Write-Output ('  runs from: ' + $Collector)
Write-Output ('  log:       ' + $log)

if ($Start) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Write-Output 'started'
}

Write-Output ''
Write-Output 'To stop or restart it (NOT Stop-ScheduledTask, which leaves the old chain running):'
Write-Output '  .\scripts\windows\stop-iphone-task.ps1 -Restart'
