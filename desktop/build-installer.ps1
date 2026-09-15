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
    throw "makensis.exe nao encontrado. Instale o NSIS (winget install NSIS.NSIS) antes de rodar este script."
}

Write-Host "`nCompilando o instalador com NSIS..." -ForegroundColor Cyan
& $makensis (Join-Path $desktopDir "odessa.nsi")
if ($LASTEXITCODE -ne 0) { throw "makensis falhou (codigo $LASTEXITCODE)." }

$outFile = Join-Path $desktopDir "build\OdessaStudioSetup.exe"
if (Test-Path $outFile) {
    $size = (Get-Item $outFile).Length / 1MB
    Write-Host "`nInstalador pronto: $outFile" -ForegroundColor Green
    Write-Host ("Tamanho: {0:N0} MB" -f $size) -ForegroundColor Green
} else {
    throw "makensis terminou sem erro mas $outFile nao foi encontrado."
}
