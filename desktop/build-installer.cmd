@echo off
REM Wrapper para rodar build-installer.ps1 sem precisar desbloquear o
REM arquivo manualmente. Baixando o repo como .zip do GitHub, o Windows
REM marca os .ps1 como "de origem desconhecida" (Mark of the Web) e o
REM PowerShell recusa rodar sem assinatura digital -- .cmd nao tem essa
REM restricao, entao -ExecutionPolicy Bypass aqui resolve sem tocar em
REM nenhuma configuracao permanente do sistema.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
