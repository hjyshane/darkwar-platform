param(
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    throw "cloudflared was not found. Install it, or expose port $Port with another HTTPS reverse proxy."
}

Write-Host "Starting a temporary HTTPS tunnel to http://127.0.0.1:$Port"
Write-Host "Copy the generated trycloudflare.com hostname into Discord Developer Portal -> Activities -> URL Mappings."
& $cloudflared.Source tunnel --url "http://127.0.0.1:$Port"
