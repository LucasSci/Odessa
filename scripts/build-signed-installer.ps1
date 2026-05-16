param(
  [switch]$SkipTests,
  [switch]$ForceCertificate,
  [switch]$TrustDevCertificate
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PythonExe = Join-Path $Root "venv\Scripts\python.exe"
$IconPath = Join-Path $Root "assets\branding\odessa-icon.ico"
$PfxPath = Join-Path $Root "certs\dev\odessa-dev-codesign.pfx"
$PasswordPath = Join-Path $Root "certs\dev\odessa-dev-codesign.password.txt"
$InstallerPath = Join-Path $Root "release\Odessa Setup 0.0.0.exe"
$AppExePath = Join-Path $Root "release\win-unpacked\Odessa.exe"
$PythonRuntimePath = Join-Path $Root "dist-runtime\python"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Set-Location $Root

Write-Step "Garantindo assets de marca"
if (!(Test-Path $PythonExe)) {
  throw "Python local nao encontrado em $PythonExe"
}
& $PythonExe (Join-Path $Root "scripts\generate-branding-assets.py")
if (!(Test-Path $IconPath)) {
  throw "Icone nao foi gerado: $IconPath"
}

Write-Step "Garantindo certificado dev"
if (!(Test-Path $PfxPath) -or $ForceCertificate) {
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "scripts\create-dev-certificate.ps1"))
  if ($ForceCertificate) { $args += "-Force" }
  powershell @args
}

$password = $env:CSC_KEY_PASSWORD
if (!$password -and (Test-Path $PasswordPath)) {
  $password = (Get-Content -LiteralPath $PasswordPath -Raw).Trim()
}
if (!$password) {
  throw "Senha do certificado ausente. Defina CSC_KEY_PASSWORD ou rode scripts\create-dev-certificate.ps1."
}

$env:CSC_LINK = $PfxPath
$env:CSC_KEY_PASSWORD = $password
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

Write-Step "Preparando runtime offline"
if (!(Test-Path $PythonRuntimePath)) {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\build-offline-installer.ps1") -SkipTests
}

Write-Step "Assinando binarios internos antes do empacotamento"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\sign-windows-binaries.ps1") -Paths "dist-runtime\python" -CertificatePath $PfxPath -Password $password

Write-Step "Gerando instalador offline"
$savedCscLink = $env:CSC_LINK
$savedCscPassword = $env:CSC_KEY_PASSWORD
Remove-Item Env:CSC_LINK -ErrorAction SilentlyContinue
Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
if (!$SkipTests) {
  npm test -- --run
  npm run build
  npm run test:backend
} else {
  npm run build
}
npm run build:electron
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) {
  throw "electron-builder falhou com exit code $LASTEXITCODE"
}
$env:CSC_LINK = $savedCscLink
$env:CSC_KEY_PASSWORD = $savedCscPassword

Write-Step "Assinando binarios empacotados com certificado dev"
$signTool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*\x64\signtool.exe" } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (!$signTool) {
  throw "signtool.exe nao encontrado. Instale Windows SDK ou rode o build sem assinatura."
}

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\sign-windows-binaries.ps1") -Paths "release\win-unpacked" -CertificatePath $PfxPath -Password $password -Force

$targetsToSign = @($AppExePath, $InstallerPath)
foreach ($target in $targetsToSign) {
  if (!(Test-Path $target)) {
    throw "Arquivo esperado nao encontrado para assinatura: $target"
  }
  & $signTool.FullName sign /f $PfxPath /p $password /fd SHA256 /td SHA256 /tr "http://timestamp.digicert.com" $target
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Timestamp falhou; tentando assinatura local sem timestamp para $target" -ForegroundColor Yellow
    & $signTool.FullName sign /f $PfxPath /p $password /fd SHA256 $target
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao assinar $target"
  }
}

Write-Step "Validando assinatura Authenticode"
$targets = @($AppExePath, $InstallerPath)
foreach ($target in $targets) {
  if (!(Test-Path $target)) {
    throw "Arquivo esperado nao encontrado: $target"
  }
  $signature = Get-AuthenticodeSignature -FilePath $target
  $subject = $signature.SignerCertificate.Subject
  if ($subject -notlike "*Odessa MVP Dev*") {
    throw "Assinatura inesperada em $target. Subject: $subject"
  }
  Write-Host "$target => $($signature.Status) / $subject" -ForegroundColor Green
}

if ($TrustDevCertificate) {
  Write-Step "Confiando certificado dev no Windows atual"
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\trust-dev-certificate.ps1") -InstallerPath $InstallerPath
}

Write-Host ""
Write-Host "Instalador assinado gerado em: $InstallerPath" -ForegroundColor Green
