<#
.SYNOPSIS
    Gera as imagens do instalador NSIS (desktop/assets/installer/*.bmp) a partir
    das cores da propria interface do Odessa (ver --bg/--accent/--sky em
    src/index.css), pra nao ficar com a tela cinza padrao do NSIS.

    So precisa rodar de novo se quiser mudar o visual -- os .bmp gerados ficam
    versionados em desktop/assets/installer/, o build normal nao chama este
    script.
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "assets\installer"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Paleta tirada de src/index.css: fundo bem escuro + gradiente azul->ciano de destaque.
$bgDark    = [System.Drawing.Color]::FromArgb(4, 6, 12)     # --bg
$bgMid     = [System.Drawing.Color]::FromArgb(17, 23, 38)   # --bg3
$accent    = [System.Drawing.Color]::FromArgb(59, 130, 246) # --accent
$accentSky = [System.Drawing.Color]::FromArgb(34, 211, 238) # --cyan
$textLight = [System.Drawing.Color]::FromArgb(234, 242, 255) # --t1
$textDim   = [System.Drawing.Color]::FromArgb(147, 168, 198) # --t2

function New-Bitmap24([int]$w, [int]$h) {
    New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
}

function Save-Bmp($bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
}

#  Welcome / Finish (164x314, barra lateral das paginas Welcome e Finish)
$w = 164; $h = 314
$bmp = New-Bitmap24 $w $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgMid, $bgDark, 90)
$g.FillRectangle($bgBrush, $rect)

# Faixa de destaque diagonal (mesmo espirito do --accent-grad do app)
$accentWidth = $w + 80
$accentRect = New-Object System.Drawing.Rectangle(-40, 40, $accentWidth, 6)
$accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($accentRect, $accent, $accentSky, 0)
$g.FillRectangle($accentBrush, $accentRect)

# Icone do app, se existir, centralizado perto do topo
$iconPath = Join-Path (Split-Path -Parent $PSScriptRoot) "public\favicon.ico"
if (Test-Path $iconPath) {
    $ico = New-Object System.Drawing.Icon($iconPath, 64, 64)
    $iconBmp = $ico.ToBitmap()
    $g.DrawImage($iconBmp, [int](($w - 64) / 2), 64, 64, 64)
    $iconBmp.Dispose(); $ico.Dispose()
}

$titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", 15, [System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
$titleBrush = New-Object System.Drawing.SolidBrush($textLight)
$subBrush = New-Object System.Drawing.SolidBrush($textDim)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center

$g.DrawString("Odessa", $titleFont, $titleBrush, (New-Object System.Drawing.RectangleF(0, 150, $w, 26)), $sf)
$g.DrawString("Studio", $subFont, $subBrush, (New-Object System.Drawing.RectangleF(0, 178, $w, 20)), $sf)

Save-Bmp $bmp (Join-Path $outDir "welcome.bmp")
$g.Dispose(); $bmp.Dispose()

#  Header (150x57, topo das paginas internas: diretorio / progresso)
$w = 150; $h = 57
$bmp = New-Bitmap24 $w $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($bgBrush, $rect)

if (Test-Path $iconPath) {
    $ico = New-Object System.Drawing.Icon($iconPath, 32, 32)
    $iconBmp = $ico.ToBitmap()
    $g.DrawImage($iconBmp, 12, 12, 32, 32)
    $iconBmp.Dispose(); $ico.Dispose()
}

$headFont = New-Object System.Drawing.Font("Segoe UI Semibold", 11, [System.Drawing.FontStyle]::Bold)
$headBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(17, 23, 38))
$g.DrawString("Odessa Studio", $headFont, $headBrush, 52, 20)

Save-Bmp $bmp (Join-Path $outDir "header.bmp")
$g.Dispose(); $bmp.Dispose()

Write-Host "Imagens do instalador geradas em $outDir" -ForegroundColor Green
