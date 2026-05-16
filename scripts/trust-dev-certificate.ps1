param(
  [string]$InstallerPath = "release\Odessa Setup 0.0.0.exe",
  [switch]$SkipUnblock
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CerPath = Join-Path $Root "certs\dev\odessa-dev-codesign.cer"
$PfxPath = Join-Path $Root "certs\dev\odessa-dev-codesign.pfx"

function Resolve-ProjectPath($PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return Join-Path $Root $PathValue
}

function Import-OdessaCertificate($StoreName) {
  $storePath = "Cert:\CurrentUser\$StoreName"
  $existing = Get-ChildItem $storePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq "CN=Odessa MVP Dev" } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if ($existing) {
    Write-Host "Certificado ja confiavel em CurrentUser\${StoreName}: $($existing.Thumbprint)" -ForegroundColor Yellow
    return
  }

  Import-Certificate -FilePath $CerPath -CertStoreLocation $storePath | Out-Null
  Write-Host "Certificado importado em CurrentUser\$StoreName" -ForegroundColor Green
}

Set-Location $Root

if (!(Test-Path $CerPath)) {
  if (!(Test-Path $PfxPath)) {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\create-dev-certificate.ps1")
  } else {
    throw "Arquivo publico do certificado nao encontrado: $CerPath. Recrie com scripts\create-dev-certificate.ps1 -Force."
  }
}

Import-OdessaCertificate "Root"
Import-OdessaCertificate "TrustedPublisher"

$resolvedInstaller = Resolve-ProjectPath $InstallerPath
if ((Test-Path $resolvedInstaller) -and !$SkipUnblock) {
  Unblock-File -LiteralPath $resolvedInstaller
  Write-Host "Bloqueio de arquivo removido: $resolvedInstaller" -ForegroundColor Green
}

if (Test-Path $resolvedInstaller) {
  $signature = Get-AuthenticodeSignature -FilePath $resolvedInstaller
  Write-Host "$resolvedInstaller => $($signature.Status) / $($signature.SignerCertificate.Subject)" -ForegroundColor Green
}
