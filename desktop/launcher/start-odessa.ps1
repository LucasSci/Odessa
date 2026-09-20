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
# A sondagem de saude usa 127.0.0.1: o uvicorn escuta so em IPv4, e "localhost"
# tenta ::1 primeiro -- cada tentativa estourava o timeout de 2s e o launcher
# nunca via o backend pronto (nem reconhecia um ja rodando).
$healthUrl = "http://127.0.0.1:$serverPort/health"
$appUrl = "http://localhost:$serverPort/"
$logDir = Join-Path $env:LOCALAPPDATA "Odessa\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "odessa.log"

function Write-Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $logFile
}

# Rotação: log passando de 5 MB vira .1 (o .1 vira .2 ...), guardando 5 cópias.
# Sem isso o backend.err.log crescia sem limite a cada execução.
function Rotate-Log($path, [long]$maxBytes = 5MB, [int]$keep = 5) {
    try {
        if (-not (Test-Path $path)) { return }
        if ((Get-Item $path).Length -lt $maxBytes) { return }
        for ($i = $keep - 1; $i -ge 1; $i--) {
            $from = "$path.$i"
            if (Test-Path $from) { Move-Item -Force $from "$path.$($i + 1)" }
        }
        Move-Item -Force $path "$path.1"
    } catch { }
}
foreach ($name in @("odessa.log", "backend.out.log", "backend.err.log")) {
    Rotate-Log (Join-Path $logDir $name)
}

# /health devolve {"service": "odessa-api"}: é a assinatura que distingue o nosso
# backend de qualquer outro programa que esteja na porta 8000.
function Test-OdessaBackend {
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -ne 200) { return $false }
        return (($resp.Content | ConvertFrom-Json).service -eq "odessa-api")
    } catch { return $false }
}

function Test-PortInUse([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(800)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
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
if (Test-OdessaBackend) {
    Write-Log "Backend já estava rodando  -  só abrindo o navegador."
    Start-Process $appUrl
    exit 0
}
if (Test-PortInUse $serverPort) {
    # Antes qualquer programa respondendo 200 em /health passava por "o Odessa
    # já está rodando", e o navegador abria a página de outro programa.
    Write-Log "Porta $serverPort ocupada por outro programa (não é o Odessa)."
    [System.Windows.Forms.MessageBox]::Show(
        "A porta $serverPort está sendo usada por outro programa, então o Odessa não consegue iniciar.`n`nFeche o programa que usa essa porta (ou reinicie o computador) e abra o Odessa de novo.",
        "Odessa  -  porta ocupada", "OK", "Warning"
    ) 2>$null
    exit 1
}

#  Sobe o backend em segundo plano
Write-Log "Iniciando backend..."
$stdOutLog = Join-Path $logDir "backend.out.log"
$stdErrLog = Join-Path $logDir "backend.err.log"

# Critico: o Chromium do Playwright foi baixado em build-runtime.ps1 com
# PLAYWRIGHT_BROWSERS_PATH=0 (fica dentro de python\Lib\site-packages\
# playwright\driver\package\.local-browsers, junto com o app, em vez do cache
# global do usuario). Sem essa MESMA variavel aqui no processo que roda o
# backend, o Playwright procura no cache global (que nao existe na maquina do
# usuario final), nao acha o Chromium embutido e a bridge do Tango falha ao
# abrir o navegador -- mesmo com os ~700MB do Chromium corretamente instalados
# ao lado do app.
$env:PLAYWRIGHT_BROWSERS_PATH = "0"

function Start-Backend {
    $proc = Start-Process -FilePath $pyExe `
        -ArgumentList @("-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", "$serverPort") `
        -WorkingDirectory $installRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdOutLog `
        -RedirectStandardError $stdErrLog `
        -PassThru
    # Sem tocar no Handle, o ExitCode pode voltar vazio depois que o processo sai.
    $null = $proc.Handle
    return $proc
}

$psi = Start-Backend

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
    Write-Log "Backend não respondeu a tempo (45s)  -  continua vivo, só está lento; o supervisor segue de olho."
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

# Supervisor: se o backend cair no meio da live, sobe de novo (espera 2s, 4s, 8s...
# até 30s entre tentativas). Cinco quedas em 2 minutos = problema de verdade, então
# avisa em vez de ficar reiniciando para sempre. Este script fica vivo (oculto) só
# para isso; o instalador e o desinstalador o encerram junto com o backend.
$crashes = New-Object System.Collections.Generic.List[datetime]
while ($true) {
    $psi.WaitForExit()
    Write-Log "Backend encerrou (código $($psi.ExitCode))."

    if (-not (Test-Path $pyExe)) {
        Write-Log "Instalação removida ou em atualização  -  supervisor encerrando."
        exit 0
    }

    $now = Get-Date
    $crashes.Add($now)
    $crashes.RemoveAll([Predicate[datetime]]{ param($t) ($now - $t).TotalSeconds -gt 120 }) | Out-Null
    if ($crashes.Count -ge 5) {
        Write-Log "Backend caiu $($crashes.Count) vezes em 2 minutos  -  desistindo. Veja $stdErrLog"
        [System.Windows.Forms.MessageBox]::Show(
            "O Odessa parou de funcionar várias vezes seguidas e não vai reiniciar sozinho.`n`nAbra o Odessa de novo pelo atalho. Se repetir, envie o log:`n$stdErrLog",
            "Odessa  -  backend parou", "OK", "Error"
        ) 2>$null
        exit 1
    }

    # Guarda o erro da queda antes que o próximo processo sobrescreva o arquivo.
    try { Copy-Item -Force $stdErrLog (Join-Path $logDir "backend.err.last-crash.log") } catch { }

    Start-Sleep -Seconds ([math]::Min(30, [math]::Pow(2, $crashes.Count)))

    if (Test-OdessaBackend) {
        Write-Log "Outro backend do Odessa já está no ar  -  supervisor encerrando."
        exit 0
    }
    Write-Log "Reiniciando backend (queda $($crashes.Count))..."
    $psi = Start-Backend
}
