param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuntimeDir = Join-Path $Root "dist-runtime"
$PythonRuntimeDir = Join-Path $RuntimeDir "python"
$LocalVenv = Join-Path $Root "venv"
$PythonExe = Join-Path $LocalVenv "Scripts\python.exe"
$Requirements = Join-Path $Root "server\requirements.txt"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Set-Location $Root

Write-Step "Validando runtime Python local"
if (!(Test-Path $PythonExe)) {
  throw "Runtime offline nao encontrado. Crie/atualize o venv local antes de empacotar: python -m venv venv; venv\Scripts\python.exe -m pip install -r server\requirements.txt"
}

if (!(Test-Path $Requirements)) {
  throw "server\requirements.txt nao encontrado."
}

Write-Step "Atualizando dependencias do runtime offline"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r $Requirements

if (!$SkipTests) {
  Write-Step "Rodando validacoes antes do empacotamento"
  npm test -- --run
  npm run build
  npm run test:backend
} else {
  Write-Step "Pulando testes por solicitacao"
  npm run build
}

Write-Step "Preparando bundle Python offline"
if (Test-Path $PythonRuntimeDir) {
  Remove-Item -LiteralPath $PythonRuntimeDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PythonRuntimeDir | Out-Null

robocopy $LocalVenv $PythonRuntimeDir /MIR /XD "__pycache__" ".pytest_cache" /XF "*.pyc" "*.pyo" | Out-Null
$RoboExit = $LASTEXITCODE
if ($RoboExit -gt 7) {
  throw "Falha ao copiar runtime Python offline. robocopy exit code: $RoboExit"
}

Write-Step "Gerando instalador Windows offline"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build:electron
npx electron-builder --win nsis --x64
if ($LASTEXITCODE -ne 0) {
  throw "electron-builder falhou com exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Instalador gerado em: $(Join-Path $Root 'release')" -ForegroundColor Green
