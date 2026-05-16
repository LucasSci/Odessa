param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CertDir = Join-Path $Root "certs\dev"
$PfxPath = Join-Path $CertDir "odessa-dev-codesign.pfx"
$CerPath = Join-Path $CertDir "odessa-dev-codesign.cer"
$PasswordPath = Join-Path $CertDir "odessa-dev-codesign.password.txt"
$Subject = "CN=Odessa MVP Dev"

function New-DevPassword {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").Replace("=", "9")
}

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

if ((Test-Path $PfxPath) -and !$Force) {
  Write-Host "Certificado dev ja existe: $PfxPath" -ForegroundColor Yellow
  if (!(Test-Path $PasswordPath) -and !$env:CSC_KEY_PASSWORD) {
    throw "Senha nao encontrada. Defina CSC_KEY_PASSWORD ou recrie com -Force."
  }
  return
}

$password = $env:CSC_KEY_PASSWORD
if (!$password) {
  $password = New-DevPassword
  Set-Content -LiteralPath $PasswordPath -Value $password -Encoding ASCII
}

$securePassword = ConvertTo-SecureString $password -AsPlainText -Force

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(5)

Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePassword -Force | Out-Null
Export-Certificate -Cert $cert -FilePath $CerPath -Force | Out-Null

Write-Host "Certificado criado: $PfxPath" -ForegroundColor Green
Write-Host "Certificado publico: $CerPath" -ForegroundColor Green
if (Test-Path $PasswordPath) {
  Write-Host "Senha local ignorada pelo git: $PasswordPath" -ForegroundColor Yellow
}
