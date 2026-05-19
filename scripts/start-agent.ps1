param(
  [string]$CloudUrl = "https://darkgrey-shark-457698.hostingersite.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:ODESSA_CLOUD_URL) {
  $env:ODESSA_CLOUD_URL = $CloudUrl
}

& ".\venv\Scripts\python.exe" -m server.agent.local_agent
