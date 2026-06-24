# Prepara a Odessa para rodar localmente (Vite + FastAPI).
param(
    [switch]$SkipNpm,
    [switch]$SkipPython,
    [switch]$Full
)

$ErrorActionPreference = "Stop"

$OdessaPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $OdessaPath

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command($Name, $Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name nao encontrado. $Hint"
    }
}

function Invoke-Native($File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Comando falhou ($LASTEXITCODE): $File $($Arguments -join ' ')"
    }
}

function Get-PythonCandidate {
    $candidates = @(
        @{ File = "py"; Args = @("-3.12") },
        @{ File = "py"; Args = @("-3.11") },
        @{ File = "python"; Args = @() }
    )

    foreach ($candidate in $candidates) {
        if (-not (Get-Command $candidate.File -ErrorAction SilentlyContinue)) {
            continue
        }
        $args = @($candidate.Args) + @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        $version = & $candidate.File @args 2>$null
        if ($LASTEXITCODE -eq 0 -and $version -in @("3.11", "3.12")) {
            return @{
                File = $candidate.File
                Args = $candidate.Args
                Version = $version
            }
        }
    }

    throw "Python 3.11 ou 3.12 nao encontrado. Instale uma dessas versoes; Python 3.13+ ainda quebra dependencias nativas deste projeto."
}

function Get-VenvVersion {
    if (-not (Test-Path "venv\Scripts\python.exe")) {
        return $null
    }
    $version = & "venv\Scripts\python.exe" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($LASTEXITCODE -ne 0) {
        return "invalid"
    }
    return $version
}

function Remove-LocalVenv {
    $venvPath = Resolve-Path "venv" -ErrorAction SilentlyContinue
    if (-not $venvPath) {
        return
    }
    $rootPath = (Resolve-Path $OdessaPath).Path.TrimEnd('\')
    $resolvedVenv = $venvPath.Path.TrimEnd('\')
    if (-not $resolvedVenv.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho do venv fora do projeto; abortando remocao: $resolvedVenv"
    }
    Remove-Item -LiteralPath $resolvedVenv -Recurse -Force
}

function New-SessionSecret {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Repair-LocalEnv {
    $envText = Get-Content ".env" -Raw
    if ($envText -match "ODESSA_SESSION_SECRET=gere-um-segredo-longo-e-aleatorio") {
        $envText = $envText -replace "ODESSA_SESSION_SECRET=.*", "ODESSA_SESSION_SECRET=$(New-SessionSecret)"
    }
    $envText = $envText -replace "VITE_API_BASE_URL=.*", "VITE_API_BASE_URL=http://localhost:8000"
    $envText = $envText -replace "ODESSA_PUBLIC_URL=.*", "ODESSA_PUBLIC_URL=http://localhost:3000"
    Set-Content ".env" $envText -Encoding UTF8
}

Write-Host "Odessa local setup" -ForegroundColor Green
Write-Host "Pasta: $OdessaPath"

Require-Command npm "Instale Node.js 22+ e rode este script novamente."

if (-not $SkipNpm) {
    Write-Step "Instalando dependencias npm"
    if (-not (Test-Path "node_modules")) {
        Invoke-Native "npm" @("install")
    } else {
        Write-Host "node_modules ja existe; pulando npm install."
    }
}

Write-Step "Configurando .env local"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    $secret = New-SessionSecret
    $envText = Get-Content ".env" -Raw
    $envText = $envText -replace "ODESSA_SESSION_SECRET=.*", "ODESSA_SESSION_SECRET=$secret"
    $envText = $envText -replace "ODESSA_ADMIN_PASSWORD=.*", "ODESSA_ADMIN_PASSWORD=troque-esta-senha"
    $envText = $envText -replace "VITE_API_BASE_URL=.*", "VITE_API_BASE_URL=http://localhost:8000"
    $envText = $envText -replace "ODESSA_PUBLIC_URL=.*", "ODESSA_PUBLIC_URL=http://localhost:3000"
    Set-Content ".env" $envText -Encoding UTF8
    Write-Host ".env criado a partir de .env.example."
} else {
    Repair-LocalEnv
    Write-Host ".env ja existe; valores locais essenciais foram conferidos."
}

if (-not $SkipPython) {
    Write-Step "Preparando ambiente Python"
    $python = Get-PythonCandidate

    $venvVersion = Get-VenvVersion
    if ($venvVersion -and $venvVersion -notin @("3.11", "3.12")) {
        Write-Host "venv usa Python $venvVersion; recriando com Python $($python.Version)." -ForegroundColor Yellow
        Remove-LocalVenv
        $venvVersion = $null
    }

    if (-not $venvVersion) {
        Invoke-Native $python.File (@($python.Args) + @("-m", "venv", "venv"))
    } else {
        Write-Host "venv ja existe com Python $venvVersion; reutilizando."
    }

    $requirements = if ($Full) { "server\requirements.txt" } else { "server\requirements-local.txt" }
    Write-Host "Instalando dependencias Python de $requirements"
    Invoke-Native "venv\Scripts\python.exe" @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Native "venv\Scripts\python.exe" @("-m", "pip", "install", "-r", $requirements)
}

Write-Host ""
Write-Host "Setup local concluido." -ForegroundColor Green
Write-Host "Para iniciar: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1"
Write-Host "Para instalar OCR/TTS pesado depois: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -Full"
Write-Host "Painel:  http://localhost:3000"
Write-Host "Overlay: http://localhost:3000/#overlay"
Write-Host "OCR:     http://localhost:3000/#capture"
