<#
.SYNOPSIS
    Confere que a pasta de staging do instalador NAO contem dados privados nem
    lixo de desenvolvimento. Falha (exit 1 / throw) se encontrar algo.

    O stage.ps1 copia server/, tango_chat/ e launcher/ da maquina de quem builda.
    Sem esta checagem, qualquer arquivo local que estivesse nessas pastas ia
    parar dentro do instalador (ja aconteceu: server/data/logs/execution.jsonl,
    1,5 MB do log de eventos do ambiente de desenvolvimento).

    Uso: .\desktop\verify-stage.ps1 -StageDir <pasta>
#>
param(
    [Parameter(Mandatory = $true)][string]$StageDir
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $StageDir)) { throw "Pasta de staging nao encontrada: $StageDir" }

# So os nossos diretorios de codigo/dados: o runtime Python embutido (~1GB) e o
# frontend buildado sao de terceiros/gerados e nao entram na varredura.
$roots = @("server", "tango_chat", "launcher") |
    ForEach-Object { Join-Path $StageDir $_ } |
    Where-Object { Test-Path $_ }

$forbiddenFilePatterns = @(
    "*.jsonl", "*.log",
    "*.db", "*.sqlite", "*.sqlite3",
    "*.bak", "*.corrupt-*", "*.tmp",
    ".env", ".env.*",
    "*.pem", "*.key", "*.pfx", "*.p12"
)
# Modelos de configuracao sao inofensivos e ficam de fora da lista proibida.
$allowedNames = @(".env.example", ".env.sample")
$forbiddenDirNames = @("tests", "logs", "runtime", "__pycache__", ".pytest_cache", ".git", "node_modules")

$secretPatterns = [ordered]@{
    "chave Google/Gemini"      = 'AIza[0-9A-Za-z_\-]{30,}'
    "chave sk- (OpenAI/Anthropic)" = '\bsk-(ant-)?[A-Za-z0-9_\-]{24,}'
    "token GitHub"             = '\bghp_[A-Za-z0-9]{30,}'
    "token Slack"              = '\bxox[baprs]-[A-Za-z0-9\-]{10,}'
    "chave privada"            = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
    "api_token/api_key literal" = '(?i)api[_-]?(token|key)["'']?\s*[:=]\s*["''][A-Za-z0-9+/=_\-]{24,}["'']'
}
$textExtensions = @(".json", ".py", ".ps1", ".psm1", ".txt", ".toml", ".yml", ".yaml", ".js", ".ts", ".cfg", ".ini", ".md", ".vbs", ".cmd", ".bat")

$problems = New-Object System.Collections.Generic.List[string]

foreach ($root in $roots) {
    foreach ($dir in Get-ChildItem -Path $root -Recurse -Force -Directory -ErrorAction SilentlyContinue) {
        if ($forbiddenDirNames -contains $dir.Name) {
            $problems.Add("pasta proibida: " + $dir.FullName.Substring($StageDir.Length).TrimStart('\'))
        }
    }
    foreach ($pattern in $forbiddenFilePatterns) {
        foreach ($file in Get-ChildItem -Path $root -Recurse -Force -File -Filter $pattern -ErrorAction SilentlyContinue) {
            if ($allowedNames -contains $file.Name) { continue }
            $problems.Add(("arquivo proibido ({0}): {1} [{2:N0} bytes]" -f $pattern, $file.FullName.Substring($StageDir.Length).TrimStart('\'), $file.Length))
        }
    }
    foreach ($file in Get-ChildItem -Path $root -Recurse -Force -File -ErrorAction SilentlyContinue) {
        if ($textExtensions -notcontains $file.Extension.ToLower()) { continue }
        if ($file.Length -gt 5MB) { continue }
        $text = [System.IO.File]::ReadAllText($file.FullName)
        foreach ($label in $secretPatterns.Keys) {
            if ($text -match $secretPatterns[$label]) {
                # Nao imprime o valor: so onde e o que parece ser.
                $problems.Add(("possivel segredo ({0}): {1}" -f $label, $file.FullName.Substring($StageDir.Length).TrimStart('\')))
            }
        }
    }
}

$unique = $problems | Sort-Object -Unique
if ($unique.Count -gt 0) {
    Write-Host "`nO staging contem itens que NAO devem ir no instalador:" -ForegroundColor Red
    $unique | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "verify-stage falhou: $($unique.Count) problema(s) no staging. Corrija o stage.ps1 (exclusoes) ou remova o arquivo."
}

Write-Host "Staging verificado: sem logs, bancos, backups, .env, chaves nem pastas de teste." -ForegroundColor Green
