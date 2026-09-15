<#
.SYNOPSIS
    Launcher do Odessa instalado  -  inicia o backend (que já serve o frontend
    sozinho, ver server/main.py) e abre a interface no navegador padrão.
    Chamado pelo atalho instalado (via start-odessa.vbs, que esconde a janela
    do console).
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

# Raiz da instalação: este script fica em <instalação>\launcher\start-odessa.ps1
$installRoot = Split-Path -Parent $PSScriptRoot
$pyExe = Join-Path $installRoot "python\python.exe"
$serverPort = 8000
# Usa "localhost" (nao 127.0.0.1) de proposito: parte do codigo do frontend
# monta URLs de API com o literal "localhost" (ver CORS em server/main.py),
# entao abrir via 127.0.0.1 causa erro de CORS nessas chamadas mesmo servindo
# o mesmo backend.
$healthUrl = "http://localhost:$serverPort/health"
$appUrl = "http://localhost:$serverPort/"
$logDir = Join-Path $env:LOCALAPPDATA "Odessa\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "odessa.log"

function Write-Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $logFile
}

#  .env com segredos gerados no primeiro uso 
# Sem isso o backend sobe com os defaults de dev (ODESSA_SESSION_SECRET fixo
# no código-fonte)  -  funciona, mas não é o ideal nem para uso local. Gerado
# uma única vez e reaproveitado nas próximas execuções.
$envFile = Join-Path $installRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Log "Gerando .env inicial..."
    function New-RandomSecret {
        # RandomNumberGenerator::Fill (estatico) so existe no .NET 6+; Windows
        # PowerShell 5.1 roda em .NET Framework, onde e preciso instanciar via
        # Create() e usar o metodo de instancia GetBytes().
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    }
    @(
        "ODESSA_SESSION_SECRET=$(New-RandomSecret)"
        "ODESSA_ADMIN_PASSWORD=$(New-RandomSecret)"
        "ODESSA_AUTH_DISABLED=1"
        "AI_PROVIDER=ollama"
    ) | Set-Content -Path $envFile -Encoding utf8
}

#  Já está rodando? 
try {
    $probe = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if ($probe.StatusCode -eq 200) {
        Write-Log "Backend já estava rodando  -  só abrindo o navegador."
        Start-Process $appUrl
        exit 0
    }
} catch { }

#  Sobe o backend em segundo plano 
Write-Log "Iniciando backend..."
$stdOutLog = Join-Path $logDir "backend.out.log"
$stdErrLog = Join-Path $logDir "backend.err.log"
$psi = Start-Process -FilePath $pyExe `
    -ArgumentList @("-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", "$serverPort") `
    -WorkingDirectory $installRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdOutLog `
    -RedirectStandardError $stdErrLog `
    -PassThru

#  Espera o /health responder (até 45s  -  cold start de dependências) 
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    if ($psi.HasExited) {
        Write-Log "Backend encerrou sozinho antes de ficar pronto (código $($psi.ExitCode)). Veja $stdErrLog"
        [System.Windows.Forms.MessageBox]::Show(
            "O Odessa não conseguiu iniciar. Veja o log em:`n$stdErrLog",
            "Odessa  -  erro ao iniciar", "OK", "Error"
        ) 2>$null
        exit 1
    }
}

if (-not $ready) {
    Write-Log "Backend não respondeu a tempo (45s)."
} else {
    Write-Log "Backend pronto. Abrindo navegador."
}
Start-Process $appUrl

#  Ollama e OBS: dependências externas que o instalador não empacota (ver
# desktop/README.md)  -  checa presença e, se ausente, abre a página oficial de
# download uma única vez por instalação (marcador em LOCALAPPDATA evita ficar
# reabrindo aba a cada execução). 
function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$markerDir = Join-Path $env:LOCALAPPDATA "Odessa"
New-Item -ItemType Directory -Force -Path $markerDir | Out-Null

$ollamaFound = (Test-CommandExists "ollama") -or (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")
$ollamaMarker = Join-Path $markerDir "ollama-prompt-shown"
if (-not $ollamaFound -and -not (Test-Path $ollamaMarker)) {
    Write-Log "Ollama não encontrado  -  abrindo página de download."
    Start-Process "https://ollama.com/download/windows"
    New-Item -ItemType File -Force -Path $ollamaMarker | Out-Null
}

$obsFound = (Test-Path "C:\Program Files\obs-studio\bin\64bit\obs64.exe") -or (Test-Path "C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe")
$obsMarker = Join-Path $markerDir "obs-prompt-shown"
if (-not $obsFound -and -not (Test-Path $obsMarker)) {
    Write-Log "OBS Studio não encontrado  -  abrindo página de download."
    Start-Process "https://obsproject.com/download"
    New-Item -ItemType File -Force -Path $obsMarker | Out-Null
}
