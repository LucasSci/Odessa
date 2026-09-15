<#
.SYNOPSIS
    Monta um runtime Python "embeddable" autocontido (interpretador + pip +
    dependências do Odessa + Chromium do Playwright) em desktop\build\python.

    Não usamos PyInstaller: dependências como playwright, numpy e soundfile
    têm histórico de problemas com a detecção automática de imports do
    PyInstaller. Rodar um Python embeddable real (com site-packages de verdade)
    é mais lento para baixar/instalar, mas muito mais confiável  -  é o mesmo
    Python que roda em dev, só que copiado para dentro do instalador.

.PARAMETER PythonVersion
    Versão do Python a empacotar. Deve bater com a versão usada em dev
    (venv atual: 3.12.10) para evitar surpresas de compatibilidade de wheels.
#>
param(
    [string]$PythonVersion = "3.12.10",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $root "desktop"
$buildDir = Join-Path $desktopDir "build"
$pyDir = Join-Path $buildDir "python"

if ($Clean -and (Test-Path $pyDir)) {
    Write-Host "Removendo runtime Python existente..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $pyDir
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

if (Test-Path (Join-Path $pyDir "python.exe")) {
    Write-Host "Runtime Python já existe em $pyDir (use -Clean para refazer do zero)." -ForegroundColor Cyan
} else {
    New-Item -ItemType Directory -Force -Path $pyDir | Out-Null

    $embedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
    $embedZip = Join-Path $buildDir "python-embed.zip"
    Write-Host "Baixando Python $PythonVersion embeddable..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $embedUrl -OutFile $embedZip -UseBasicParsing

    Write-Host "Extraindo..." -ForegroundColor Cyan
    Expand-Archive -Path $embedZip -DestinationPath $pyDir -Force
    Remove-Item $embedZip

    # O Python embeddable vem com site-packages DESABILITADO por padrão (o
    # arquivo ._pth restringe o sys.path). Sem isso, pip/qualquer pacote
    # instalado em Lib\site-packages é ignorado silenciosamente.
    $pthFile = Get-ChildItem -Path $pyDir -Filter "python*._pth" | Select-Object -First 1
    if (-not $pthFile) { throw "Arquivo ._pth não encontrado no Python embeddable  -  layout inesperado." }
    (Get-Content $pthFile.FullName) -replace '^#import site$', 'import site' | Set-Content $pthFile.FullName
    Add-Content $pthFile.FullName "`nLib\site-packages"

    Write-Host "Instalando pip..." -ForegroundColor Cyan
    $getPip = Join-Path $buildDir "get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip -UseBasicParsing
    & (Join-Path $pyDir "python.exe") $getPip --no-warn-script-location
    Remove-Item $getPip
}

$pyExe = Join-Path $pyDir "python.exe"
$reqFile = Join-Path $desktopDir "requirements.txt"

Write-Host "Instalando dependências do Odessa no runtime empacotado..." -ForegroundColor Cyan
& $pyExe -m pip install --no-warn-script-location -r $reqFile
if ($LASTEXITCODE -ne 0) { throw "pip install falhou (código $LASTEXITCODE)." }

Write-Host "Confirmando que pacotes pesados conhecidos NÃO entraram de carona (torch/cv2/pyautogui/easyocr)..." -ForegroundColor Cyan
$unwanted = @("torch", "opencv-python-headless", "opencv-python", "pyautogui", "easyocr")
$installed = (& $pyExe -m pip list --format=freeze) -join "`n"
foreach ($pkg in $unwanted) {
    if ($installed -match "(?im)^$([regex]::Escape($pkg))==") {
        Write-Warning "Pacote pesado inesperado instalado: $pkg  -  verifique desktop\requirements.txt e as dependências transitivas."
    }
}

Write-Host "Baixando o Chromium do Playwright (usado pela bridge do Tango em modo standalone)..." -ForegroundColor Cyan
$env:PLAYWRIGHT_BROWSERS_PATH = "0"  # instala dentro do próprio venv/runtime, não em %LOCALAPPDATA%
& $pyExe -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "playwright install chromium falhou (código $LASTEXITCODE)." }

Write-Host "`nRuntime Python pronto em: $pyDir" -ForegroundColor Green
$size = (Get-ChildItem $pyDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("Tamanho total: {0:N0} MB" -f $size) -ForegroundColor Green
