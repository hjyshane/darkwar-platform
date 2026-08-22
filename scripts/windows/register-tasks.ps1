# Register the three processes continuous collection needs.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI, so
# non-ASCII here does not merely display wrong - it can break the parser.
# A build script was lost to exactly that.
#
# Not a service: BlueStacks and Npcap capture both need a desktop session.
# dumpcap is the packet source rather than dw-capture, which keeps one
# reassembler for the life of the process and goes silently quiet when a
# stream wedges. Reading files gives every file a fresh one.
#
# This file used to live only in C:\DW_data, which is how a fix to it could
# not be reviewed, tested, or recovered. The machine-specific parts are
# parameters now; everything else is the same script.
#
    #   register-tasks.ps1
#
# Find the interface with:  & 'C:\Program Files\Wireshark\dumpcap.exe' -D
#
# On a machine that has been registered before, -Interface is optional: the
# device name is read back out of the run-Capture.cmd this script wrote, so a
# re-registration keeps capture on the adapter it is already bound to.

[CmdletBinding()]
param(
    # The NPF device name, not the friendly name: dumpcap -i takes either, but
    # the friendly name on this machine is Korean and survives neither the
    # .cmd file nor the task XML intact.
    [string]$Interface  = $env:DW_CAPTURE_NPF_DEVICE,
    [string]$CaptureDir = 'C:\DW_data\live',
    [string]$LogDir     = 'C:\DW_data\logs',
    [string]$ScriptDir  = 'C:\DW_data',
    [string]$Collector  = 'C:\darkwar-platform\services\collector',
    [string]$Dumpcap    = 'C:\Program Files\Wireshark\dumpcap.exe',
    # Rows per sync drain. 100 kept up with live capture and is eleven hours
    # of catching up after any outage; the cost of a drain is the round trips,
    # not the rows.
    [int]$SyncBatchSize = 1000,
    # SWEEP MODE. Cuts the three timings that decide how long a sighting takes
    # to reach the dashboard, for a session where somebody is watching the
    # screen while they pan the map.
    #
    # The default is a compromise for running all day. Sweep mode is not: it
    # writes four times as many capture files and polls three times as often,
    # which is fine for the half hour of a sweep and wasteful as a permanent
    # setting. Run it again WITHOUT -Sweep to go back.
    #
    #   register-tasks.ps1 -Sweep    # before a sweep
    #   register-tasks.ps1           # after, to go back
    #
    # What it cannot fix: dumpcap only hands over a file it has CLOSED, so the
    # rotation period is the floor on staleness either way. 15s is as short as
    # is sensible - below that the per-file reassembler setup starts costing
    # more than the latency it saves.
    [switch]$Sweep
)

# Rotation, min-age and poll. Worst case is their sum, plus the sync loop:
#   normal  60 + 20 + 30 = 110s
#   sweep   15 +  5 + 10 =  30s
$timings = if ($Sweep) {
    @{ Rotation = 15; MinAge = 5; Poll = 10; Files = 5760 }
} else {
    @{ Rotation = 60; MinAge = 20; Poll = 30; Files = 1440 }
}
# A day of history either way: quarter the rotation, quadruple the ring.
# Losing that is how a sweep session silently costs the previous day's
# capture, which is not a trade anybody asked for.

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'FAIL: run this from an elevated PowerShell (registering tasks needs it).'
    exit 1
}
# Reuse the interface already in use before asking for one.
#
# This script WRITES run-Capture.cmd, so the device name in it is the one
# capture is bound to right now - which is exactly the one a re-registration
# wants. Requiring the operator to supply it again is how a routine
# re-registration turns into a choice, and choosing wrong out of `dumpcap -D`
# rebinds capture to an adapter that never sees the game: dumpcap keeps running,
# the task reads Running, the log stays quiet, and nothing arrives for hours.
#
# An explicit -Interface still wins. This is the fallback, not the default.
if (-not $Interface) {
    $previous = Join-Path $ScriptDir 'run-Capture.cmd'
    if (Test-Path $previous) {
        $found = Select-String -Path $previous -Pattern '(\\Device\\NPF_\{[0-9A-Fa-f-]+\})' |
            Select-Object -First 1
        if ($found) {
            $Interface = $found.Matches[0].Groups[1].Value
            Write-Output ('interface: reusing ' + $Interface)
            Write-Output ('           from ' + $previous + ' - pass -Interface to change it')
        }
    }
}
if (-not $Interface) {
    Write-Output 'FAIL: no capture interface. Pass -Interface or set DW_CAPTURE_NPF_DEVICE.'
    Write-Output ("      list them with:  & '" + $Dumpcap + "' -D")
    exit 1
}
if (-not (Test-Path $Dumpcap)) {
    Write-Output ('FAIL: dumpcap not found at ' + $Dumpcap)
    exit 1
}

$uv = (Get-Command uv).Source

New-Item -ItemType Directory -Force -Path $CaptureDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ScriptDir | Out-Null

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

# Repetition attached to the at-logon trigger BEFORE registering.
#
# At-logon alone left collection down for 18.7 hours: all three tasks exited
# with 0xC000013A (a console Ctrl+C), which Task Scheduler does not count as
# a failure, so RestartCount never applied and nothing restarted them.
# MultipleInstances IgnoreNew means a running task ignores the repeat, so
# this only ever revives a dead one.
#
# Assigned as a Repetition object rather than passed as -RepetitionInterval:
# PowerShell 5.1 drops that parameter when no duration is given, and does it
# silently - the task registers looking correct with no repetition on it,
# which happened twice.
#
# And NOT via `schtasks /change`, which prompts for the account password.
# Nothing here needs a stored credential; the task runs as the logged-on user.
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (
    New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
).Repetition

# Each task runs through wscript -> cmd, and both parts are load-bearing.
#
# wscript, because PowerShell -WindowStyle Hidden does NOT hide anything when
# Task Scheduler starts it in an interactive session: three empty console
# windows appeared at every logon anyway. WScript.Shell.Run with style 0 has
# no window at all.
#
# cmd's >> rather than PowerShell's *>>, because PowerShell 5.1 writes
# redirections as UTF-16 and the log tail in dw-console reads UTF-8, which
# made every line arrive as mojibake. cmd copies the child's bytes through
# untouched, and PYTHONIOENCODING makes those bytes UTF-8.
#
# A .cmd per task rather than one long nested command line. Task Scheduler,
# wscript and cmd each have their own quoting rules, and threading one string
# through all three is how this kind of thing breaks silently. A file has no
# quoting problem at all.
$launcher = Join-Path $ScriptDir 'run-hidden.vbs'

# The launcher must return the child's exit code.
#
# It used to swallow it: WScript.Shell.Run's return value went unused and
# wscript exited 0, so a task whose worker died on startup reported
# LastTaskResult 0 - indistinguishable from a clean run. DarkWar-Ingest sat
# in that state for hours, restarted every five minutes by the repetition
# trigger and failing within a second each time, while the task history said
# success. The repetition is what actually revives things here; propagating
# the code is what makes the failure legible when it does not.
$vbs = @(
    "' Launch a command with no window at all."
    "'"
    "' PowerShell -WindowStyle Hidden does not do this when Task Scheduler starts"
    "' it in an interactive session: a console window still appears and stays."
    "' WScript.Shell.Run with intWindowStyle 0 genuinely has none."
    "'"
    #   register-tasks.ps1
    'Option Explicit'
    'Dim shell, command, code'
    'If WScript.Arguments.Count < 1 Then WScript.Quit 2'
    'Set shell = CreateObject("WScript.Shell")'
    'command = WScript.Arguments(0)'
    "' 0 = hidden, True = wait for the child so its exit code is ours to"
    "' return. Returning it is the point: Task Scheduler judges the task by"
    "' what wscript exits with, and a swallowed code reads as success."
    'code = shell.Run(command, 0, True)'
    'WScript.Quit code'
)
[IO.File]::WriteAllLines($launcher, $vbs, [Text.UTF8Encoding]::new($false))

function New-HiddenAction {
    param(
        [string]$Name, [string]$Exe, [string]$TaskArgs,
        [string]$Dir, [string]$Log, [hashtable]$Env = @{}
    )
    $script = Join-Path $ScriptDir "run-$Name.cmd"
    # chcp 65001 as well as PYTHONIOENCODING: dumpcap is not Python, and it
    # writes the interface's friendly name - which is Korean on this machine -
    # in the console codepage. Without this the capture tab showed mojibake on
    # every startup line even after the UTF-16 redirection was fixed.
    $body = @(
        '@echo off'
        'chcp 65001 >nul'
        'set PYTHONIOENCODING=utf-8'
    )
    foreach ($key in $Env.Keys) { $body += ("set $key=" + $Env[$key]) }
    $body += "cd /d `"$Dir`""
    $body += "`"$Exe`" $TaskArgs >> `"$Log`" 2>&1"
    # ASCII, no BOM: cmd chokes on a UTF-8 BOM at the top of a batch file.
    [IO.File]::WriteAllLines($script, $body, [Text.UTF8Encoding]::new($false))
    New-ScheduledTaskAction -Execute 'wscript.exe' `
        -Argument "//B //Nologo `"$launcher`" `"$script`"" `
        -WorkingDirectory $Dir
}

# --no-sync on every uv invocation.
#
# This is the fix for the outage that produced a 288,471-row backlog. `uv run`
# re-syncs the project environment before it runs anything, and syncing
# rewrites the console scripts in .venv\Scripts. dw-sync is a long-running
# task holding dw-sync.exe open, so every ingest start hit
#
#   error: failed to remove file `...\.venv\...\Scripts\dw-sync.exe`:
#   The process cannot access the file because it is being used by another
#   process. (os error 32)
#
# and exited before doing any work. Two tasks sharing one project directory
# make this permanent, not intermittent: ingest can never start while sync is
# alive. --no-sync takes the environment as it finds it, which is what a
# supervised process should do anyway - installing dependencies is not a
# thing a scheduled task should be doing behind the operator's back.
#
# The environment is instead synced once below, while everything is stopped.
$uvRun = 'run --no-sync'

$tasks = @(
    @{
        Name = 'DarkWar-Capture'
        # 1-minute files, 1440 of them: still a day of history, and a wedged
        # decoder still costs one file rather than the rest of the run.
        #
        # Was 5 minutes. A file is only ingested after dumpcap closes it, so
        # the rotation period is the floor on how stale the dashboard can be -
        # it was 5m30s end to end. That floor also has to be shorter than the
        # UI worker's `expect` timeout, which waits for a command to reach the
        # journal before sending the next tap; at 5 minutes a 94-member sweep
        # could not verify a single step.
        Exe  = $Dumpcap
        # Double quotes: these end up in a .cmd file, and cmd treats a single
        # quote as an ordinary character. With single quotes dumpcap saw
        # "8680'" as a separate argument and refused to start.
        Args = "-i `"$Interface`" -f `"tcp port 8680`" -w `"$CaptureDir\cap.pcapng`" -b duration:$($timings.Rotation) -b files:$($timings.Files) -B 64"
        Dir  = $CaptureDir
        Log  = "$LogDir\capture.log"
        # Match the WHOLE chain: wscript -> cmd -> uv -> python. The first
        # attempt matched only the uv wrapper ("run dw-sync"), because that is
        # the argument list written here - but the process that actually holds
        # the log open is the python underneath, whose command line reads
        # "...\Scripts\dw-sync.exe" with no "run" in it. Killing the wrapper
        # and leaving the worker is worse than not killing at all: the log
        # stays locked, every new task fails its `>>` redirect, and all three
        # go straight back to Ready.
        Match = @("$CaptureDir\cap.pcapng", 'run-Capture.cmd')
    },
    @{
        Name = 'DarkWar-Ingest'
        Exe  = $uv
        # Poll and min-age both cut to match the 60s ring. min-age is what
        # keeps the file dumpcap is still writing out of the reader; 20s is
        # comfortably past a rotation without adding a minute of lag.
        # Worst case: 60 (rotation) + 20 (min-age) + 30 (poll) = 110s.
        Args = "$uvRun dw-collector ingest-dir --dir `"$CaptureDir`" --min-age-seconds $($timings.MinAge) --interval-seconds $($timings.Poll)"
        Dir  = $Collector
        Log  = "$LogDir\ingest.log"
        Match = @('ingest-dir', 'run-Ingest.cmd')
    },
    @{
        Name = 'DarkWar-Sync'
        Exe  = $uv
        Args = "$uvRun dw-sync"
        Dir  = $Collector
        Log  = "$LogDir\sync.log"
        Env  = @{ DW_SYNC_BATCH_SIZE = $SyncBatchSize }
        Match = @('dw-sync', 'run-Sync.cmd')
    },
    @{
        # Missing until now, and that is the whole reason nothing a board
        # published ever reached Discord. BOTH halves live in this process -
        # working out what to announce AND posting it - so with no task the
        # outbox was neither filled nor drained. The settings screen's "Send
        # test" button only enqueues a row, which is what made the gap look
        # like a webhook or routing problem rather than a missing process.
        Name = 'DarkWar-Notify'
        Exe  = $uv
        # Its own task rather than folded into dw-sync: an outward-facing POST
        # to a third party must not be able to stall the path data takes to the
        # cloud behind it. It sleeps five minutes between passes, so this is a
        # long-running task like sync, not a periodic one.
        Args = "$uvRun dw-notify"
        # The repo root .env is found by walking up from here, the same way
        # every other entrypoint finds it.
        Dir  = $Collector
        Log  = "$LogDir\notify.log"
        Match = @('dw-notify', 'run-Notify.cmd')
    }
)

$failed = @()

# Stop and unregister everything BEFORE touching the logs.
#
# A running task holds its log open through cmd's `>>`, so rotating first
# fails with a sharing violation on whichever task happens to be alive - which
# it did, on sync.log.
#
# Cmdlets, not `schtasks ... 2>&1`. Same trap as the uv sync below: with
# $ErrorActionPreference 'Stop', redirecting a native command's stderr makes
# every stderr line a terminating error. `schtasks /end` writes "ERROR: The
# system cannot find the file specified." when the task is not registered -
# which is the normal first-run case, and which killed this script partway
# through a re-registration, leaving all three tasks unregistered and
# collection down until it was run again.
foreach ($task in $tasks) {
    Stop-ScheduledTask -TaskName $task.Name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction SilentlyContinue
}

# Then kill what /end left behind.
#
# /end terminates the task's own process - wscript - and nothing below it.
# The cmd, uv and python underneath are orphaned and keep running. One
# dw-sync survived this way for 17 minutes while its task read "Ready",
# still writing to Supabase and still holding sync.log open.
#
# That is the same class of failure as the 18.7-hour outage: the task state
# said one thing and the machine was doing another. Match on the command line
# rather than the image name, because uv.exe and python.exe are also this
# session's tooling and a broad kill would take those with it.
$candidates = Get-CimInstance Win32_Process `
    -Filter "Name='uv.exe' or Name='python.exe' or Name='dumpcap.exe' or Name='cmd.exe' or Name='wscript.exe'"
foreach ($task in $tasks) {
    foreach ($pattern in $task.Match) {
        $candidates |
            Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $pattern + '*') } |
            ForEach-Object {
                Write-Output ("kill  " + $task.Name + " : orphan pid " + $_.ProcessId + " (" + $_.Name + ")")
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }
}
Start-Sleep -Seconds 2  # let the handles on the log files actually close

# Prove the kill worked before going any further.
#
# A surviving worker keeps its log open, and cmd's `>>` cannot open a locked
# file - so the task starts, fails the redirect, and exits 0 within a second.
# Task Scheduler then shows "Ready" and LastTaskResult 0, which reads exactly
# like a task that has never been asked to run. Registering on top of that
# produces three tasks that look fine and collect nothing.
foreach ($task in $tasks) {
    if (-not (Test-Path $task.Log)) { continue }
    try {
        $handle = [IO.File]::Open($task.Log, 'Open', 'ReadWrite', 'None')
        $handle.Close()
    } catch {
        Write-Output ("FAIL " + $task.Name + " : " + $task.Log + " still locked - a worker survived the kill")
        Write-Output '      find it with:'
        Write-Output ("      Get-CimInstance Win32_Process | ? { `$_.CommandLine -like '*" + $task.Match[0] + "*' }")
        $failed += $task.Name
    }
}
if ($failed.Count -gt 0) {
    Write-Output ''
    Write-Output 'Not registering: the logs are not free, so the tasks would exit immediately.'
    exit 1
}

# Sync the environment once, here, with every worker stopped.
#
# This is the counterpart to --no-sync: the tasks no longer install anything,
# so something has to, and this is the one moment in the lifecycle when
# nothing holds a handle on .venv\Scripts. Run this script again after
# changing dependencies.
Write-Output ''
Write-Output ('sync  ' + $Collector)
#
# NOT `& $uv sync 2>&1`. Redirecting a native command's stderr inside
# PowerShell 5.1 wraps each line in an ErrorRecord, and $ErrorActionPreference
# 'Stop' turns that into a terminating NativeCommandError - uv writes its
# progress to stderr, so a perfectly successful sync aborted this script
# after it had already unregistered and killed all three tasks. Collection was
# down until it was run again. Let the child write straight to the console and
# judge it by $LASTEXITCODE, which is the only thing that means failure.
Push-Location $Collector
try {
    & $uv sync
    if ($LASTEXITCODE -ne 0) {
        Write-Output 'FAIL: uv sync failed - the tasks would start against an incomplete venv.'
        exit 1
    }
} finally {
    Pop-Location
}

# Roll the logs aside. Re-registering means the previous arguments were wrong,
# so what is in the file is a record of a run that no longer applies - and the
# console tails these files, which would otherwise open showing the failure
# that was just fixed. Renamed, not deleted: the evidence is still there.
#
# Best-effort: a stale handle is not a reason to abandon the registration,
# which is the part that actually matters.
foreach ($task in $tasks) {
    if (Test-Path $task.Log) {
        try {
            Move-Item $task.Log ($task.Log + '.prev') -Force -ErrorAction Stop
        } catch {
            Write-Output ("WARN " + $task.Name + " : could not rotate " + $task.Log + " (still open)")
        }
    }
}

foreach ($task in $tasks) {
    $name = $task.Name
    $taskEnv = if ($task.ContainsKey('Env')) { $task.Env } else { @{} }
    $action = New-HiddenAction -Name ($name -replace 'DarkWar-', '') -Exe $task.Exe `
        -TaskArgs $task.Args -Dir $task.Dir -Log $task.Log -Env $taskEnv
    try {
        Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
            -Settings $settings -Description 'Dark War continuous collection' -ErrorAction Stop | Out-Null
    } catch {
        Write-Output ("FAIL " + $name + " : " + $_.Exception.Message)
        $failed += $name
    }
}

# Verify rather than announce. Earlier versions printed success after doing
# nothing - once on an access-denied, once on a silently dropped trigger.
Write-Output ''
Write-Output '--- check ---'
foreach ($task in $tasks) {
    $name = $task.Name
    $registered = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $registered) {
        Write-Output ("FAIL " + $name + " : not registered")
        $failed += $name
        continue
    }
    $repeat = $registered.Triggers | ForEach-Object { $_.Repetition.Interval } | Where-Object { $_ }
    $hidden = $registered.Actions[0].Execute -match 'wscript'
    $script = Join-Path $ScriptDir ('run-' + ($name -replace 'DarkWar-', '') + '.cmd')
    $text   = if (Test-Path $script) { Get-Content $script -Raw } else { '' }
    $logged = $text -match [regex]::Escape($task.Log)
    # A uv task without --no-sync cannot start while another uv task is
    # running. Checked here because the symptom is a task that looks
    # registered, looks scheduled, and reports success while doing nothing.
    $noSync = ($task.Exe -ne $uv) -or ($text -match '--no-sync')
    if (-not $repeat) {
        Write-Output ("FAIL " + $name + " : no repetition trigger - a dead task will stay dead")
        $failed += $name
    } elseif (-not $hidden) {
        Write-Output ("FAIL " + $name + " : window not hidden")
        $failed += $name
    } elseif (-not $logged) {
        Write-Output ("FAIL " + $name + " : not writing to " + $task.Log)
        $failed += $name
    } elseif (-not $noSync) {
        Write-Output ("FAIL " + $name + " : uv without --no-sync - it will fight the other task for .venv")
        $failed += $name
    } else {
        Write-Output ("OK   " + $name + " : logon + repeat " + $repeat + ", hidden, log -> " + $task.Log)
    }
}

if ($failed.Count -gt 0) {
    Write-Output ''
    Write-Output ("failed: " + ($failed -join ', '))
    exit 1
}

# Start them, then check they are still up.
#
# Starting is not the same as running. The failure this script exists to
# prevent looked exactly like a successful start: the task went Running for
# under a second, the worker died, and the state fell back to Ready with
# LastTaskResult 0. Ten seconds is long enough for that to have happened.
Write-Output ''
foreach ($task in $tasks) { Start-ScheduledTask -TaskName $task.Name }
Start-Sleep -Seconds 10

Write-Output '--- running ---'
foreach ($task in $tasks) {
    $state = (Get-ScheduledTask -TaskName $task.Name).State
    $code  = (Get-ScheduledTaskInfo -TaskName $task.Name).LastTaskResult
    if ($state -ne 'Running') {
        Write-Output ("FAIL " + $task.Name + " : " + $state + " after 10s, last result 0x" + ('{0:X}' -f $code))
        Write-Output ("      why:  Get-Content '" + $task.Log + "' -Tail 20")
        $failed += $task.Name
    } else {
        Write-Output ("OK   " + $task.Name + " : Running")
    }
}

Write-Output ''
if ($failed.Count -gt 0) {
    Write-Output ("failed: " + ($failed -join ', '))
    exit 1
}
# Counted, not spelled out. This said "All three" for one task longer than it
# was true - dw-notify made it four, and a summary line that disagrees with the
# check above it is worse than no summary line.
Write-Output ('All ' + $tasks.Count + ' registered and running.')

# Which mode took effect, and the worst-case lag it buys.
#
# Printed because the mode is invisible afterwards: the tasks look identical
# in the scheduler and the only difference is three numbers buried in their
# arguments. An operator who forgets to run this again without -Sweep leaves
# the machine writing four times the capture files indefinitely, and nothing
# on screen would ever say so.
$worst = $timings.Rotation + $timings.MinAge + $timings.Poll
if ($Sweep) {
    Write-Output ('SWEEP MODE: ' + $worst + 's worst case to the dashboard, plus the sync loop.')
    Write-Output '  Run this again WITHOUT -Sweep when the sweep is done.'
} else {
    Write-Output ('Normal mode: ' + $worst + 's worst case to the dashboard, plus the sync loop.')
    Write-Output '  Use -Sweep before a map sweep for roughly 30s.'
}
