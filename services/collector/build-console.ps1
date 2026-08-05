# Build dw-console.exe.
#
# A single windowed executable, so the collector can be started by
# double-clicking without a console window behind it and without knowing
# where uv or the checkout live.
#
# The .exe is a convenience, not the product: it bundles this package only,
# and the three collection processes still run as scheduled tasks so they
# survive the window being closed.
#
# ASCII only. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI, so
# non-ASCII text here does not merely display wrong - it breaks the parser.

# Continue rather than Stop: uv writes its progress to stderr, and with Stop
# PowerShell treats that as a failure and aborts a build that is going fine.
# Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# Sync first, and insist that it worked.
#
# `uv run` reinstalls the package before running, and that replaces every
# console-script .exe in .venv\Scripts. A running dw-capture or dw-sync holds
# its own .exe open, so the replacement fails with "os error 32" - and then
# PyInstaller happily bundles the previous install. The result is an .exe with
# a fresh timestamp and last week's code, which is exactly what happened: the
# window came up titled in a language that had been removed from the source
# two commits earlier.
uv sync --extra capture
if ($LASTEXITCODE -ne 0) {
    Write-Output ''
    Write-Output 'FAIL: uv sync failed. A running collector process holds its .exe open;'
    Write-Output '      stop the tasks first:'
    Write-Output "      foreach (`$n in 'DarkWar-Capture','DarkWar-Ingest','DarkWar-Sync') { schtasks /end /tn `$n }"
    exit 1
}

$sources = Get-ChildItem (Join-Path $PSScriptRoot 'src\dw_collector') -Recurse -Filter *.py
$newestSource = ($sources | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime

uv run --with pyinstaller pyinstaller `
    --noconfirm --clean `
    --onefile --windowed `
    --name dw-console `
    --paths src `
    --hidden-import dw_collector.console.state `
    --hidden-import dw_collector.console.logs `
    src\dw_collector\console\__main__.py
if ($LASTEXITCODE -ne 0) {
    Write-Output ''
    Write-Output 'FAIL: PyInstaller exited nonzero'
    exit 1
}

$exe = Join-Path $PSScriptRoot 'dist\dw-console.exe'
if (-not (Test-Path $exe)) {
    Write-Output 'FAIL: dist\dw-console.exe was not produced'
    exit 1
}

# "A file is there" is not "the build ran". An .exe older than the newest
# source file is a leftover, and reporting OK on one wastes the next hour
# looking for a bug in code that was never built.
if ((Get-Item $exe).LastWriteTime -lt $newestSource) {
    Write-Output ''
    Write-Output ('FAIL: ' + $exe + ' is older than the newest source file - stale build')
    exit 1
}

$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Output ''
Write-Output ('OK: ' + $exe + ' (' + $size + ' MB)')

# Desktop shortcut, so "the program" has somewhere to live.
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $env:USERPROFILE 'Desktop\Dark War Collector.lnk'))
$link.TargetPath = $exe
$link.WorkingDirectory = $PSScriptRoot
$link.Description = 'Dark War collector console'
$link.Save()
Write-Output 'Shortcut: Desktop\Dark War Collector.lnk'
