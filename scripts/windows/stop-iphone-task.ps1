# Stop DarkWar-iPhone for real, or restart it.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI.
#
#   .\scripts\windows\stop-iphone-task.ps1              stop it
#   .\scripts\windows\stop-iphone-task.ps1 -Restart     stop it, then start it
#   .\scripts\windows\stop-iphone-task.ps1 -DryRun      only list what would be killed
#
# WHY Stop-ScheduledTask IS NOT ENOUGH. It ends the task's own process (the
# wscript launcher) and nothing below it. The cmd -> uv -> python chain that
# wscript started keeps running, still on the OLD code, still holding the phone.
# On 2026-10-08 a "restart" with Stop-/Start-ScheduledTask left the old chain
# alive, and the new one started beside it and exited with code 1.
#
# WHAT THIS KILLS: the process trees rooted at
#   - the task's launcher cmd (its command line names run-<TaskName>.cmd), and
#   - any python running `-m dw_collector.iphone` (an orphan left by an earlier
#     stop, or a copy started by hand),
# children first. It never matches on `dw_collector.sync` or `ingest-dir`
# by name: the always-on DarkWar-Ingest / DarkWar-Sync tasks run those, and
# they are not ours to stop. dw-iphone's own ingest and sync children are
# killed as part of its tree, which is the only way they are reached.

[CmdletBinding()]
param(
    [string]$TaskName = 'DarkWar-iPhone',
    [switch]$Restart,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-Descendants([int]$ProcessId, [object[]]$All) {
    foreach ($child in $All | Where-Object { $_.ParentProcessId -eq $ProcessId }) {
        Get-Descendants $child.ProcessId $All
        $child
    }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Output ('FAIL: no scheduled task named ' + $TaskName)
    exit 1
}

if (-not $DryRun) {
    # Ends the launcher, so the repetition trigger cannot see a live instance
    # and start a second chain while the old one is being killed.
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

$all = @(Get-CimInstance Win32_Process)
$launcher = 'run-' + $TaskName + '.cmd'
$roots = @($all | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and (
        ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like ('*' + $launcher + '*')) -or
        ($_.Name -like 'python*' -and $_.CommandLine -like '*-m dw_collector.iphone*')
    )
})

if ($roots.Count -eq 0) {
    Write-Output 'nothing of this chain is running'
} else {
    $doomed = @()
    foreach ($root in $roots) {
        $doomed += @(Get-Descendants $root.ProcessId $all)
        $doomed += $root
    }
    $doomed = $doomed | Sort-Object ProcessId -Unique
    foreach ($proc in $doomed) {
        $line = ($proc.CommandLine -replace '\s+', ' ')
        if ($line.Length -gt 100) { $line = $line.Substring(0, 100) }
        Write-Output ('{0,-8} {1,-22} {2}' -f $proc.ProcessId, $proc.Name, $line)
    }
    if ($DryRun) {
        Write-Output ('dry run: would stop ' + $doomed.Count + ' processes')
        exit 0
    }
    # Children before parents, or a parent respawns nothing but a child is
    # reparented and survives.
    foreach ($proc in ($doomed | Sort-Object ProcessId -Descending)) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $left = @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -like '*-m dw_collector.iphone*' -or $_.CommandLine -like ('*' + $launcher + '*')
    })
    if ($left.Count -gt 0) {
        Write-Output ('WARNING: ' + $left.Count + ' processes of the chain are still running')
        exit 1
    }
    Write-Output 'stopped'
}

if ($Restart -and -not $DryRun) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 8
    $state = (Get-ScheduledTask -TaskName $TaskName).State
    Write-Output ('task state: ' + $state)
    if ($state -ne 'Running') {
        Write-Output 'WARNING: the task did not stay running; read C:\DW_data\logs\iphone.log'
        exit 1
    }
}
