<#
.SYNOPSIS
    Cria (se ainda nao existir) um certificado autoassinado de code signing
    para assinar o OdessaStudioSetup.exe. Isso NAO remove o aviso do
    SmartScreen para o publico em geral -- so remove nas maquinas onde o
    certificado publico (.cer) for explicitamente instalado como confiavel
    (ver desktop/trust-cert.ps1). Ainda assim vale a pena: a janela do UAC/
    propriedades do arquivo passa a mostrar "Odessa Studio" como editor em
    vez de "Editor desconhecido", e a assinatura garante que o instalador
    nao foi alterado depois de gerado.

    A chave privada (.pfx, com senha) fica em desktop/build/codesign/ --
    dentro de build/, que ja e ignorado pelo git (nunca deve ser commitado).
    O certificado publico (.cer, sem chave privada, seguro para distribuir)
    fica em desktop/codesign/ e E versionado.
#>
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$desktopDir = $PSScriptRoot
$pfxDir = Join-Path $desktopDir "build\codesign"
$cerDir = Join-Path $desktopDir "codesign"
$pfxPath = Join-Path $pfxDir "odessa-codesign.pfx"
$pfxPasswordPath = Join-Path $pfxDir "pfx-password.txt"
$cerPath = Join-Path $cerDir "OdessaStudio-CodeSign.cer"

if ((Test-Path $pfxPath) -and (Test-Path $cerPath) -and -not $Force) {
    Write-Host "Certificado ja existe em $pfxPath (use -Force para gerar um novo)." -ForegroundColor Yellow
    return
}

New-Item -ItemType Directory -Force -Path $pfxDir | Out-Null
New-Item -ItemType Directory -Force -Path $cerDir | Out-Null

Write-Host "Gerando certificado autoassinado de code signing..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Odessa Studio, O=Odessa Studio" `
    -KeyUsage DigitalSignature `
    -FriendlyName "Odessa Studio Code Signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(10) `
    -KeyExportPolicy Exportable `
    -KeyAlgorithm RSA `
    -KeyLength 2048

# Senha aleatoria so pra proteger o arquivo .pfx em repouso -- fica salva ao
# lado dele (fora do git) porque o build precisa dela pra assinar, mas so
# quem tem acesso a esta maquina/pasta consegue ler os dois juntos.
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$pfxPasswordPlain = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
$securePwd = ConvertTo-SecureString -String $pfxPasswordPlain -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
Set-Content -Path $pfxPasswordPath -Value $pfxPasswordPlain -Encoding utf8 -NoNewline
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Remove do cert store do Windows -- so precisamos dos arquivos exportados;
# nao faz sentido deixar o certificado "instalado" na maquina de build.
Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue

Write-Host "Certificado gerado:" -ForegroundColor Green
Write-Host "  Chave privada (NAO compartilhar): $pfxPath"
Write-Host "  Certificado publico (pode distribuir): $cerPath"
