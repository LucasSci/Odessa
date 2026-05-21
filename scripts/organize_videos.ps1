# Script para organizar os vídeos da Odessa
# Local: C:\Users\Lucas\Downloads\Odessa Model 2

$targetDir = "C:\Users\Lucas\Downloads\Odessa Model 2"
$extrasDir = Join-Path $targetDir "extras"

if (!(Test-Path $targetDir)) {
    Write-Error "Diretório não encontrado: $targetDir"
    exit
}

# 1. Criar pasta extras se não existir
if (!(Test-Path $extrasDir)) {
    New-Item -ItemType Directory -Path $extrasDir
}

Write-Host "Movendo arquivos para a pasta extras..."
# 2. Mover tudo para extras (exceto a própria pasta extras e o script se estivesse lá)
Get-ChildItem -Path $targetDir -File | Move-Item -Destination $extrasDir -Force

# 3. Mapeamento de IDs para nomes de arquivo originais
$mapping = @{
    "01" = "Thank_you_for_the_compliment._202605040057.mp4"
    "02" = "Thank_you_for_the_compliment_202605040057_2.mp4"
    "03" = "Thank_you_for_the_compliment_202605040057_3.mp4"
    "04" = "Woman_in_cozy_room_202605040057.mp4"
    "05" = "Woman_in_cozy_room_202605040057_2.mp4"
    "06" = "Woman_looking_at_screen_202605040057_3.mp4"
    "07" = "Woman_shifting_gaze_to_right_202605040057.mp4"
    "08" = "Woman_shifting_gaze_to_right_202605040057_2.mp4"
    "09" = "Woman_smiling_with_closed_lips_202605040057.mp4"
    "10" = "Woman_smiling_with_subtle_motion_202605040057_4.mp4"
    "11" = "Woman_smiling_with_subtle_motion_202605040057_5.mp4"
    "12" = "Woman_smiling_with_subtle_motion_202605040057_6.mp4"
    "13" = "Woman_smiling_with_subtle_motion_202605040057_7.mp4"
    "14" = "Woman_with_blonde_hair_blinking_202605040057_2.mp4"
    "15" = "Woman_with_blonde_hair_blinking_202605040057_3.mp4"
    "16" = "Woman_with_blonde_hair_blinking_202605040057_4.mp4"
}

Write-Host "Renomeando e movendo vídeos selecionados..."
foreach ($id in $mapping.Keys | Sort-Object) {
    $oldName = $mapping[$id]
    $oldPath = Join-Path $extrasDir $oldName
    $newName = "video_$id.mp4"
    $newPath = Join-Path $targetDir $newName
    
    if (Test-Path $oldPath) {
        Move-Item -Path $oldPath -Destination $newPath -Force
        Write-Host "OK: $oldName -> $newName"
    } else {
        Write-Warning "Arquivo não encontrado: $oldName"
    }
}

# 4. Criar arquivo de mapeamento para referência
$mappingFile = Join-Path $targetDir "mapping.txt"
$mappingContent = @"
MAPEAMENTO DE VÍDEOS ODESSA
===========================
ID | Arquivo Original                                   | Uso Recomendado
---|----------------------------------------------------|----------------
01 | Thank_you_for_the_compliment._202605040057.mp4     | Agradecimento Forte
02 | Thank_you_for_the_compliment_202605040057_2.mp4   | Gift / Doação
03 | Thank_you_for_the_compliment_202605040057_3.mp4   | Agradecimento Suave
04 | Woman_in_cozy_room_202605040057.mp4                | Âncora Principal / Idle
05 | Woman_in_cozy_room_202605040057_2.mp4              | Retorno Suave
06 | Woman_looking_at_screen_202605040057_3.mp4         | Lendo Tela/Chat
07 | Woman_shifting_gaze_to_right_202605040057.mp4      | Olha p/ Lado
08 | Woman_shifting_gaze_to_right_202605040057_2.mp4    | Olha p/ Lado (Alt)
09 | Woman_smiling_with_closed_lips_202605040057.mp4    | Sorriso Fechado
10 | Woman_smiling_with_subtle_motion_202605040057_4.mp4| Mexe no Cabelo
11 | Woman_smiling_with_subtle_motion_202605040057_5.mp4| Cabelo Lateral
12 | Woman_smiling_with_subtle_motion_202605040057_6.mp4| Cabelo Pescoço
13 | Woman_smiling_with_subtle_motion_202605040057_7.mp4| Cabelo no Peito
14 | Woman_with_blonde_hair_blinking_202605040057_2.mp4 | Ponte de Piscada
15 | Woman_with_blonde_hair_blinking_202605040057_3.mp4 | Retorno Lateral
16 | Woman_with_blonde_hair_blinking_202605040057_4.mp4 | Âncora Próxima
"@
$mappingContent | Out-File -FilePath $mappingFile -Encoding utf8

# 5. Criar pasta com a Sequência Principal (Loop Vivo) configurada
$seqDir = Join-Path $targetDir "SEQUENCIA_PRINCIPAL"
if (!(Test-Path $seqDir)) {
    New-Item -ItemType Directory -Path $seqDir
}

Write-Host "`nConfigurando pasta SEQUENCIA_PRINCIPAL..."
$mainSequence = @(
    @{ id = "04"; name = "01_idle_base.mp4" },
    @{ id = "14"; name = "02_ponte_piscada.mp4" },
    @{ id = "16"; name = "03_idle_proximo.mp4" },
    @{ id = "09"; name = "04_olhar_lateral_sorriso.mp4" },
    @{ id = "05"; name = "05_retorno_suave.mp4" }
)

foreach ($item in $mainSequence) {
    $sourceFile = Join-Path $targetDir ("video_" + $item.id + ".mp4")
    $destFile = Join-Path $seqDir $item.name
    
    if (Test-Path $sourceFile) {
        Copy-Item -Path $sourceFile -Destination $destFile -Force
        Write-Host "Copiado: video_$($item.id) -> $($item.name)"
    }
}

Write-Host "`nConcluído! Verifique a pasta: $targetDir"
Write-Host "A sequência principal está em: $seqDir"
