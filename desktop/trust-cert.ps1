<#
.SYNOPSIS
    Roda isso UMA VEZ em cada maquina onde voce for instalar o Odessa Studio
    (menos a maquina onde ele foi compilado) pra fazer o Windows parar de
    mostrar o aviso de "editor desconhecido" pro instalador assinado.

    Nao precisa ser admin: instala o certificado so pro usuario atual
    (Cert:\CurrentUser\Root), que e o suficiente pro SmartScreen/UAC confiar
    nele quando o instalador (assinado com a chave correspondente) rodar
    com esse mesmo usuario do Windows.

.EXAMPLE
    .\trust-cert.ps1
#>
param(
    [string]$CerPath = (Join-Path $PSScriptRoot "codesign\OdessaStudio-CodeSign.cer")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CerPath)) {
    throw "Certificado nao encontrado em $CerPath. Ele deve vir junto com este script (desktop\codesign\OdessaStudio-CodeSign.cer)."
}

Import-Certificate -FilePath $CerPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Host "Certificado do Odessa Studio instalado como confiavel para este usuario." -ForegroundColor Green
Write-Host "Agora o instalador assinado nao deve mais mostrar aviso de editor desconhecido." -ForegroundColor Green
