# Script para iniciar Odessa Web local (Frontend + Backend)
param(
    [switch]$Backend,
    [switch]$FrontendOnly
)

$ErrorActionPreference = "Stop"

$OdessaPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $OdessaPath

function Assert-LocalSetup {
    if (-not (Test-Path ".env")) {
        throw ".env nao encontrado. Rode: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1"
    }
    if (-not (Test-Path "venv\Scripts\python.exe")) {
        throw "venv nao encontrado. Rode: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1"
    }
    if (-not (Test-Path "node_modules")) {
        throw "node_modules nao encontrado. Rode: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1"
    }
}

function Show-Urls {
    Write-Host ""
    Write-Host "URLs locais:" -ForegroundColor Cyan
    Write-Host "  Painel:  http://localhost:3000"
    Write-Host "  Overlay: http://localhost:3000/#overlay"
    Write-Host "  OCR:     http://localhost:3000/#capture"
    Write-Host "  Health:  http://localhost:8000/health"
    Write-Host ""
}

Assert-LocalSetup

# Ativa o virtual environment para comandos executados neste terminal.
& "venv\Scripts\Activate.ps1"

if ($Backend) {
    # Modo: apenas backend
    Show-Urls
    Write-Host "Iniciando servidor Python em http://localhost:8000..." -ForegroundColor Green
    npm run dev:api
} elseif ($FrontendOnly) {
    # Modo: apenas frontend
    Show-Urls
    Write-Host "Iniciando frontend web em http://localhost:3000..." -ForegroundColor Green
    npm run dev
} else {
    # Modo: frontend + backend
    Show-Urls
    Write-Host "Iniciando servidor Python em background..." -ForegroundColor Green
    $backendCommand = "Set-Location '$OdessaPath'; & 'venv\Scripts\Activate.ps1'; npm run dev:api"
    $backendProcess = Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand -PassThru
    Write-Host "Backend iniciado (PID $($backendProcess.Id))."

    Write-Host "Aguardando servidor iniciar..." -ForegroundColor Green
    Start-Sleep -Seconds 4

    Write-Host "Iniciando frontend web em http://localhost:3000..." -ForegroundColor Green
    npm run dev
}
