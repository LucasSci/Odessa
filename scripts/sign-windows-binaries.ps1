param(
  [string[]]$Paths = @("dist-runtime\python", "release\win-unpacked"),
  [string]$CertificatePath = "certs\dev\odessa-dev-codesign.pfx",
  [string]$Password,
  [switch]$Force,
  [switch]$NoTimestamp
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Extensions = @(".exe", ".dll", ".pyd", ".node")

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

function Should-Sign($FilePath) {
  if ($Force) {
    return $true
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  if (!$signature.SignerCertificate) {
    return $true
  }

  if ($signature.Status -eq "Valid") {
    return $false
  }

  return $signature.SignerCertificate.Subject -notlike "*Odessa MVP Dev*"
}

function Sign-File($FilePath, $SignTool, $PfxPath, $CertPassword) {
  $arguments = @("sign", "/f", $PfxPath, "/p", $CertPassword, "/fd", "SHA256")
  if (!$NoTimestamp) {
    $arguments += @("/td", "SHA256", "/tr", "http://timestamp.digicert.com")
  }
  $arguments += $FilePath

  & $SignTool @arguments
  if ($LASTEXITCODE -ne 0 -and !$NoTimestamp) {
    Write-Host "Timestamp falhou; tentando assinatura sem timestamp: $FilePath" -ForegroundColor Yellow
    & $SignTool sign /f $PfxPath /p $CertPassword /fd SHA256 $FilePath
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao assinar $FilePath"
  }
}

Set-Location $Root

$resolvedCertificate = Resolve-ProjectPath $CertificatePath
$passwordPath = Join-Path (Split-Path -Parent $resolvedCertificate) "odessa-dev-codesign.password.txt"
if (!$Password) {
  $Password = $env:CSC_KEY_PASSWORD
}
if (!$Password -and (Test-Path $passwordPath)) {
  $Password = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
}
if (!(Test-Path $resolvedCertificate)) {
  throw "Certificado nao encontrado: $resolvedCertificate"
}
if (!$Password) {
  throw "Senha do certificado ausente. Defina CSC_KEY_PASSWORD ou informe -Password."
}

$signTool = Get-SignTool
$signed = 0
$skipped = 0

foreach ($pathValue in $Paths) {
  $resolvedPath = Resolve-ProjectPath $pathValue
  if (!(Test-Path $resolvedPath)) {
    Write-Host "Pulando caminho ausente: $resolvedPath" -ForegroundColor Yellow
    continue
  }

  $files = Get-ChildItem -LiteralPath $resolvedPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $Extensions -contains $_.Extension.ToLowerInvariant() }

  foreach ($file in $files) {
    if (Should-Sign $file.FullName) {
      Sign-File $file.FullName $signTool $resolvedCertificate $Password
      $signed += 1
    } else {
      $skipped += 1
    }
  }
}

Write-Host "Assinatura recursiva concluida. Assinados: $signed. Mantidos: $skipped." -ForegroundColor Green
