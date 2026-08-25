param(
    [switch]$Desktop,
    [switch]$StartMenu,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$OdessaPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $OdessaPath

if (-not $Desktop -and -not $StartMenu) {
    Write-Host "Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-odessa-shortcut.ps1 -Desktop [-StartMenu] [-Force]" -ForegroundColor Yellow
    Write-Host "  -Desktop    Cria o atalho na área de trabalho"
    Write-Host "  -StartMenu  Cria o atalho no menu Iniciar (Programas)"
    Write-Host "  -Force      Substitui atalhos existentes"
    exit 1
}

if (-not (Test-Path "scripts\start-odessa.ps1")) {
    throw "Não foi possível encontrar scripts\start-odessa.ps1. Execute este script a partir da raiz do repositório Odessa."
}

function New-Shortcut($shortcutPath) {
    if ((Test-Path $shortcutPath) -and (-not $Force)) {
        Write-Host "O atalho já existe: $shortcutPath" -ForegroundColor Yellow
        return
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$OdessaPath\scripts\start-odessa.ps1`""
    $shortcut.WorkingDirectory = $OdessaPath
    $shortcut.WindowStyle = 1
    $shortcut.Description = "Iniciar Odessa (frontend + backend local)"

    $iconPath = Join-Path $OdessaPath 'assets\branding\odessa-icon.ico'
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = $iconPath
    }

    $shortcut.Save()
    Write-Host "Atalho criado: $shortcutPath" -ForegroundColor Green
}

if ($Desktop) {
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $desktopShortcut = Join-Path $desktopPath 'Odessa.lnk'
    New-Shortcut $desktopShortcut
}

if ($StartMenu) {
    $programsPath = [Environment]::GetFolderPath('Programs')
    $menuFolder = Join-Path $programsPath 'Odessa'
    if (-not (Test-Path $menuFolder)) {
        New-Item -ItemType Directory -Path $menuFolder | Out-Null
    }
    $startMenuShortcut = Join-Path $menuFolder 'Odessa.lnk'
    New-Shortcut $startMenuShortcut
}
