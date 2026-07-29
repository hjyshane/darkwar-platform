$ErrorActionPreference = "Stop"
$taskName = "DarkWar Tracker Services"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed Windows task: $taskName"
Read-Host "Press Enter to close"
