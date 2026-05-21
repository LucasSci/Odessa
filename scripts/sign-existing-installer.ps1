param(
  [string]$InstallerPath = "release\Odessa Setup 0.0.0.exe",
  [string]$AppExePath = "release\win-unpacked\Odessa.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$IconPath = Join-Path $Root "assets\branding\odessa-icon.ico"
$PfxPath = Join-Path $Root "certs\dev\odessa-dev-codesign.pfx"
$PasswordPath = Join-Path $Root "certs\dev\odessa-dev-codesign.password.txt"
$RcEdit = Join-Path $Root "node_modules\electron-winstaller\vendor\rcedit.exe"

function Resolve-ProjectPath($PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return Join-Path $Root $PathValue
}

function Get-SignTool {
  $tool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\x64\signtool.exe" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (!$tool) {
    throw "signtool.exe nao encontrado. Instale Windows SDK."
  }
  return $tool.FullName
}

function Sign-Target($Target, $SignTool, $Password) {
  if (!(Test-Path $Target)) {
    Write-Host "Pulando arquivo ausente: $Target" -ForegroundColor Yellow
    return
  }
  & $SignTool sign /f $PfxPath /p $Password /fd SHA256 /td SHA256 /tr "http://timestamp.digicert.com" $Target
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Timestamp falhou; tentando assinatura local sem timestamp para $Target" -ForegroundColor Yellow
    & $SignTool sign /f $PfxPath /p $Password /fd SHA256 $Target
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao assinar $Target"
  }
}

Set-Location $Root

if (!(Test-Path $IconPath)) {
  & (Join-Path $Root "venv\Scripts\python.exe") (Join-Path $Root "scripts\generate-branding-assets.py")
}
if (!(Test-Path $PfxPath)) {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\create-dev-certificate.ps1")
}
$password = $env:CSC_KEY_PASSWORD
if (!$password -and (Test-Path $PasswordPath)) {
  $password = (Get-Content -LiteralPath $PasswordPath -Raw).Trim()
}
if (!$password) {
  throw "Senha do certificado ausente. Defina CSC_KEY_PASSWORD ou gere o certificado dev."
}

$resolvedInstaller = Resolve-ProjectPath $InstallerPath
$resolvedAppExe = Resolve-ProjectPath $AppExePath
$signTool = Get-SignTool

if ((Test-Path $resolvedAppExe) -and (Test-Path $RcEdit)) {
  & $RcEdit $resolvedAppExe --set-icon $IconPath
}

Sign-Target $resolvedAppExe $signTool $password
Sign-Target $resolvedInstaller $signTool $password

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\sign-windows-binaries.ps1") -Paths "release\win-unpacked" -CertificatePath $PfxPath -Password $password -Force

foreach ($target in @($resolvedAppExe, $resolvedInstaller)) {
  if (Test-Path $target) {
    $signature = Get-AuthenticodeSignature -FilePath $target
    Write-Host "$target => $($signature.Status) / $($signature.SignerCertificate.Subject)" -ForegroundColor Green
  }
}
