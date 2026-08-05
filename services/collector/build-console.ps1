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
# The check that matters is whether the .exe exists afterwards.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

uv run --with pyinstaller pyinstaller `
    --noconfirm --clean `
    --onefile --windowed `
    --name dw-console `
    --paths src `
    --hidden-import dw_collector.console.state `
    --hidden-import dw_collector.console.logs `
    src\dw_collector\console\__main__.py

$exe = Join-Path $PSScriptRoot 'dist\dw-console.exe'
if (-not (Test-Path $exe)) {
    Write-Output 'FAIL: dist\dw-console.exe was not produced'
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
