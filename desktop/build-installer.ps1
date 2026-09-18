<#
.SYNOPSIS
    Pipeline completo: monta o runtime Python (se ainda nao existir), builda
    o frontend + monta o staging, e compila o instalador final com NSIS.

    Uso normal (primeira vez ou depois de mudar dependencias Python):
        .\desktop\build-installer.ps1

    Rebuild rapido so do app (sem remontar o runtime Python, que e a parte lenta):
        .\desktop\build-installer.ps1 -SkipRuntimeBuild
#>
param(
    [switch]$SkipRuntimeBuild,
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$desktopDir = $PSScriptRoot

$artDir = Join-Path $desktopDir "assets\installer"
if (-not (Test-Path (Join-Path $artDir "welcome.bmp")) -or -not (Test-Path (Join-Path $artDir "header.bmp"))) {
    Write-Host "Gerando imagens do instalador..." -ForegroundColor Cyan
    & (Join-Path $desktopDir "generate-installer-art.ps1")
}

& (Join-Path $desktopDir "generate-codesign-cert.ps1")

if (-not $SkipRuntimeBuild) {
    # Nao checa $LASTEXITCODE aqui: e o exit code do ULTIMO comando nativo
    # rodado (ex.: robocopy, que retorna codigos != 0 mesmo em sucesso), nao
    # do script .ps1 chamado. Uma falha real dentro do script filho ja para
    # a execucao sozinha via throw + ErrorActionPreference=Stop propagado.
    & (Join-Path $desktopDir "build-runtime.ps1")
}

$stageArgs = @()
if ($SkipFrontendBuild) { $stageArgs += "-SkipFrontendBuild" }
& (Join-Path $desktopDir "stage.ps1") @stageArgs

$makensis = @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $makensis) {
    Write-Host "`nNSIS nao encontrado -- instalando via winget (NSIS.NSIS)..." -ForegroundColor Yellow
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wingetCmd) {
        throw "makensis.exe nao encontrado e winget nao esta disponivel nesta maquina. Instale o NSIS manualmente em https://nsis.sourceforge.io/Download e rode este script de novo."
    }
    & winget install --id NSIS.NSIS --accept-source-agreements --accept-package-agreements -e
    if ($LASTEXITCODE -ne 0) {
        throw "winget install NSIS.NSIS falhou (codigo $LASTEXITCODE). Instale manualmente (https://nsis.sourceforge.io/Download) e rode este script de novo."
    }
    # Nao depende de PATH (winget as vezes so atualiza o PATH numa sessao
    # nova do terminal) -- confere direto nos caminhos de instalacao padrao.
    $makensis = @(
        "C:\Program Files (x86)\NSIS\makensis.exe",
        "C:\Program Files\NSIS\makensis.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $makensis) {
        throw "NSIS foi instalado pelo winget, mas makensis.exe nao apareceu nos caminhos esperados. Reabra o PowerShell (para pegar o PATH atualizado) e rode este script de novo."
    }
    Write-Host "NSIS instalado com sucesso." -ForegroundColor Green
}

Write-Host "`nCompilando o instalador com NSIS..." -ForegroundColor Cyan
& $makensis (Join-Path $desktopDir "odessa.nsi")
if ($LASTEXITCODE -ne 0) { throw "makensis falhou (codigo $LASTEXITCODE)." }

$outFile = Join-Path $desktopDir "build\OdessaStudioSetup.exe"
if (-not (Test-Path $outFile)) {
    throw "makensis terminou sem erro mas $outFile nao foi encontrado."
}

#  Assina o instalador com o certificado autoassinado (ver generate-codesign-cert.ps1 /
# desktop/README.md) -- nao remove o aviso do SmartScreen pro publico em geral, mas troca
# "Editor desconhecido" por "Odessa Studio" em qualquer maquina onde o .cer publico
# (desktop/codesign/OdessaStudio-CodeSign.cer) for importado via desktop/trust-cert.ps1.
$pfxPath = Join-Path $desktopDir "build\codesign\odessa-codesign.pfx"
$pfxPasswordPath = Join-Path $desktopDir "build\codesign\pfx-password.txt"
$signtool = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*x64*" } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName

if ((Test-Path $pfxPath) -and (Test-Path $pfxPasswordPath) -and $signtool) {
    Write-Host "`nAssinando o instalador (certificado autoassinado)..." -ForegroundColor Cyan
    $pfxPassword = Get-Content -Path $pfxPasswordPath -Raw
    & $signtool sign /f $pfxPath /p $pfxPassword /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 /d "Odessa Studio" $outFile
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Falha ao assinar o instalador (signtool saiu com codigo $LASTEXITCODE) -- instalador gerado sem assinatura."
    } else {
        Write-Host "Instalador assinado. Rode desktop\trust-cert.ps1 em cada maquina de destino para o Windows confiar na assinatura." -ForegroundColor Green
    }
} else {
    Write-Warning "Certificado ou signtool.exe nao encontrado -- instalador gerado sem assinatura (ver desktop/README.md)."
}

$size = (Get-Item $outFile).Length / 1MB
Write-Host "`nInstalador pronto: $outFile" -ForegroundColor Green
Write-Host ("Tamanho: {0:N0} MB" -f $size) -ForegroundColor Green
