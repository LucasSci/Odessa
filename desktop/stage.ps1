<#
.SYNOPSIS
    Monta a pasta "staged" com tudo que o instalador NSIS vai empacotar:
    frontend buildado, codigo do backend, runtime Python embutido, assets
    e os scripts do launcher. Nao inclui venv/node_modules/.git.

    Pre-requisito: rode desktop\build-runtime.ps1 antes (monta desktop\build\python).
#>
param(
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $root "desktop"
$stageDir = Join-Path $desktopDir "build\stage"
$pyDir = Join-Path $desktopDir "build\python"

if (-not (Test-Path (Join-Path $pyDir "python.exe"))) {
    throw "Runtime Python nao encontrado em $pyDir. Rode desktop\build-runtime.ps1 primeiro."
}

if (-not $SkipFrontendBuild) {
    if (-not (Test-Path (Join-Path $root "node_modules"))) {
        Write-Host "node_modules nao encontrado -- rodando npm install..." -ForegroundColor Yellow
        Push-Location $root
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            cmd /c "npm install"
            $installExit = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEap
            Pop-Location
        }
        if ($installExit -ne 0) { throw "npm install falhou (codigo $installExit)." }
    }

    Write-Host "Buildando o frontend (npm run build)..." -ForegroundColor Cyan
    Push-Location $root
    # npm/vite escrevem avisos benignos no stderr; com ErrorActionPreference=Stop
    # o PowerShell 5.1 trata QUALQUER linha de stderr de um exe nativo como erro
    # fatal, mesmo com exit code 0. Usa o exit code real em vez do stream de erro.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        cmd /c "npm run build"
        $buildExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
    if ($buildExit -ne 0) { throw "npm run build falhou (codigo $buildExit)." }
}

$distDir = Join-Path $root "dist"
if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    throw "dist\index.html nao encontrado. O build do frontend falhou ou foi pulado sem um dist existente."
}

Write-Host "Limpando pasta de staging anterior..." -ForegroundColor Cyan
if (Test-Path $stageDir) {
    # Remove-Item -Recurse falha com "nao foi possivel localizar uma parte
    # do caminho" em builds anteriores com arquivos do Chromium empacotado
    # (caminhos bem profundos) -- e o limite classico de ~260 caracteres do
    # Windows, nao um arquivo faltando de verdade. robocopy /MIR usa APIs
    # nativas que nao tem esse limite, entao espelha uma pasta vazia por
    # cima (esvazia $stageDir sem apagar a pasta em si) e so depois remove
    # a pasta ja vazia -- isso funciona mesmo sem long paths habilitado.
    $emptyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("odessa-empty-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    robocopy $emptyDir $stageDir /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy falhou limpando $stageDir (codigo $LASTEXITCODE)." }
    Remove-Item -Force $emptyDir -ErrorAction SilentlyContinue
    Remove-Item -Force $stageDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

function Copy-Tree($from, $to, [string[]]$excludeDirs = @(), [string[]]$excludeFiles = @()) {
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    $robocopyArgs = @($from, $to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP")
    foreach ($ex in $excludeDirs) { $robocopyArgs += @("/XD", (Join-Path $from $ex)) }
    if ($excludeFiles.Count -gt 0) { $robocopyArgs += @("/XF") + $excludeFiles }
    robocopy @robocopyArgs | Out-Null
    # robocopy usa codigos de saida != 0 para "sucesso com arquivos copiados" (0-7 = ok).
    if ($LASTEXITCODE -ge 8) { throw "robocopy falhou copiando $from (codigo $LASTEXITCODE)." }
}

Write-Host "Copiando backend (server/)..." -ForegroundColor Cyan
# server/runtime e' estado de SESSAO (videos gerados, fila, historico, logs)
# que o app recria sozinho na primeira execucao -- nao e' codigo, e copia-lo
# (a) ia inflar o instalador com o conteudo da instalacao de quem builda, e
# (b) trava o robocopy se o backend de dev estiver rodando e escrevendo
# nesses mesmos arquivos ao vivo (visto na pratica: robocopy ficou parado
# por 30+ min tentando ler um arquivo bloqueado). .pytest_cache tambem nao
# e' necessario num runtime empacotado.
# Nada do que e LOCAL do ambiente de quem builda pode ir para os usuarios:
#   data\logs      log de eventos (execution.jsonl, ~1,5 MB no ambiente de dev)
#   tests          testes automatizados
#   *.jsonl/*.log/*.db  logs e bancos locais;  .env*  segredos
#   *.bak/*.corrupt-*   copias/quarentena do atomic_json (dados locais)
# O verify-stage.ps1 (no fim) FALHA o build se algum desses escapar.
$serverExcludeDirs = @("__pycache__", "runtime", ".pytest_cache", "tests", "data\logs")
$serverExcludeFiles = @("*.jsonl", "*.log", "*.db", "*.sqlite", "*.sqlite3", "*.bak", "*.corrupt-*", "*.tmp", ".env", ".env.*")
Copy-Tree (Join-Path $root "server") (Join-Path $stageDir "server") $serverExcludeDirs $serverExcludeFiles
Get-ChildItem -Path (Join-Path $stageDir "server") -Recurse -Filter "__pycache__" -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Copiando bridge do Tango (tango_chat/)..." -ForegroundColor Cyan
Copy-Tree (Join-Path $root "tango_chat") (Join-Path $stageDir "tango_chat") @("__pycache__") @("*.log", "*.bak", ".env", ".env.*")
Get-ChildItem -Path (Join-Path $stageDir "tango_chat") -Recurse -Filter "__pycache__" -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Copiando frontend buildado (dist/)..." -ForegroundColor Cyan
Copy-Tree $distDir (Join-Path $stageDir "dist")

Write-Host "Copiando assets (videos das personas)..." -ForegroundColor Cyan
Copy-Tree (Join-Path $root "assets") (Join-Path $stageDir "assets")

Write-Host "Copiando runtime Python embutido (isso pode levar um tempo, sao ~200-400MB)..." -ForegroundColor Cyan
Copy-Tree $pyDir (Join-Path $stageDir "python")

Write-Host "Copiando scripts do launcher..." -ForegroundColor Cyan
Copy-Tree (Join-Path $desktopDir "launcher") (Join-Path $stageDir "launcher")

Write-Host "Copiando icone..." -ForegroundColor Cyan
Copy-Item (Join-Path $root "public\favicon.ico") (Join-Path $stageDir "favicon.ico") -Force

# server/main.py espera encontrar server/data/*.json com as personas. Copia
# tambem server/core, server/api etc via Copy-Tree acima ja cobre isso (esta
# tudo dentro de server/) -- so confirma que server/data existe no destino.
if (-not (Test-Path (Join-Path $stageDir "server\data\personas.json"))) {
    Write-Warning "server\data\personas.json nao encontrado no staging -- personas podem nao carregar na primeira execucao."
}

# Falha o build se sobrou dado privado/lixo de desenvolvimento no staging.
& (Join-Path $desktopDir "verify-stage.ps1") -StageDir $stageDir

$size = (Get-ChildItem $stageDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "`nStaging pronto em: $stageDir" -ForegroundColor Green
Write-Host ("Tamanho total: {0:N0} MB" -f $size) -ForegroundColor Green
# robocopy deixa $LASTEXITCODE = 1 ("arquivos copiados") e o PowerShell o repassa
# como codigo de saida do script; chegou aqui, entao deu certo.
exit 0
