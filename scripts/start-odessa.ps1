# Script para iniciar Odessa (Frontend + Backend)
param([switch]$Backend)

$OdessaPath = "C:\Users\Lucas\Desktop\Odessa"
Set-Location $OdessaPath

# Ative o virtual environment
& "venv\Scripts\Activate.ps1"

if ($Backend) {
    # Modo: apenas backend
    Write-Host "Iniciando servidor Python..." -ForegroundColor Green
    npm run dev:api
} else {
    # Modo: frontend + backend
    Write-Host "Iniciando servidor Python em background..." -ForegroundColor Green
    $backendProcess = Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$OdessaPath'; & 'venv\Scripts\Activate.ps1'; npm run dev:api" -PassThru
    
    Write-Host "Aguardando servidor iniciar..." -ForegroundColor Green
    Start-Sleep -Seconds 4
    
    Write-Host "Iniciando frontend..." -ForegroundColor Green
    npm run dev
}
