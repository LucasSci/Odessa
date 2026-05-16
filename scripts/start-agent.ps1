param(
  [string]$CloudUrl = "https://odessa-gules.vercel.app"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:ODESSA_CLOUD_URL) {
  $env:ODESSA_CLOUD_URL = $CloudUrl
}

& ".\venv\Scripts\python.exe" -m server.agent.local_agent
