; Instalador do Odessa Studio (NSIS + Modern UI 2).
; Compila com: makensis desktop\odessa.nsi
; Espera que desktop\build\stage ja exista (rode build-runtime.ps1 + stage.ps1 antes)
; e que desktop\assets\installer\*.bmp exista (rode generate-installer-art.ps1 antes,
; ou use o que ja esta versionado no repo).

!define APP_NAME "Odessa Studio"
!define APP_VERSION "1.0.0"
!define APP_VERSION_FULL "1.0.0.0"
!define APP_PUBLISHER "Odessa Studio"
!define APP_EXE_TARGET "launcher\start-odessa.vbs"
!define STAGE_DIR "build\stage"
!define ART_DIR "assets\installer"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OdessaStudio"

Name "${APP_NAME}"
OutFile "build\OdessaStudioSetup.exe"
InstallDir "$LOCALAPPDATA\OdessaStudio"
InstallDirRegKey HKCU "Software\OdessaStudio" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; O instalador e assinado (signtool) DEPOIS de compilado, em build-installer.ps1.
; A assinatura Authenticode e anexada ao final do arquivo, o que muda o
; tamanho total e quebra a checagem de CRC interna do proprio NSIS (calculada
; sobre o arquivo original, sem a assinatura) -- o instalador assinado
; passava a falhar com "Installer integrity check has failed" mesmo estando
; intacto. A propria assinatura Authenticode ja garante a integridade do
; arquivo (o Windows recusa uma assinatura cujo hash nao bate mais), entao
; desligar a checagem redundante do NSIS aqui e seguro e e a pratica padrao
; para instaladores NSIS assinados apos a compilacao.
CRCCheck off

VIProductVersion "${APP_VERSION_FULL}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "Instalador do ${APP_NAME}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "${APP_PUBLISHER}"

;  Modern UI 2

!include "MUI2.nsh"

!define MUI_ICON "..\public\favicon.ico"
!define MUI_UNICON "..\public\favicon.ico"
!define MUI_ABORTWARNING

!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ART_DIR}\header.bmp"
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ART_DIR}\welcome.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ART_DIR}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_NOSTRETCH

!define MUI_WELCOMEPAGE_TITLE "Bem-vindo(a) ao Odessa Studio"
!define MUI_WELCOMEPAGE_TEXT "Este assistente vai instalar (ou atualizar, se ja houver uma instalacao) o Odessa Studio nesta maquina.$\n$\nTudo que o app precisa para rodar (backend, interface e o navegador Chromium usado pela integracao com o Tango) ja vem embutido no instalador -- nao precisa instalar Python, Node nem nenhuma outra dependencia de desenvolvedor.$\n$\nSe voce ja tem o Odessa Studio instalado, seus dados (.env, sessao) sao preservados -- so os arquivos do programa sao atualizados.$\n$\nOllama (IA local) e OBS Studio (transmissao) sao aplicativos separados; se nao estiverem instalados, o proprio Odessa Studio vai abrir a pagina de download deles na primeira vez que voce rodar.$\n$\nClique em Avancar para continuar."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Instalacao concluida"
!define MUI_FINISHPAGE_TEXT "O Odessa Studio foi instalado (ou atualizado) com sucesso.$\n$\nLembrete: o Ollama (IA local) e o OBS Studio (transmissao) sao instalados a parte -- o app verifica e abre a pagina de download deles automaticamente se faltar algum."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE_TARGET}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Odessa Studio agora"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

; Deteccao de instalacao existente: roda antes de qualquer pagina aparecer.
; InstallDirRegKey ja pre-preenche o diretorio se achar a chave, mas isso
; sozinho nao evita falha ao sobrescrever arquivos em uso -- se o usuario
; roda o instalador de novo (ex.: apos uma atualizacao de codigo) com o app
; ainda aberto, o File /r abaixo falha tentando sobrescrever DLLs/exe do
; Python que o backend ja tem carregado.
;
; Encerra so o(s) processo(s) python.exe cujo caminho executavel esta DENTRO
; desta instalacao (nunca um Python de outro programa ou do dev). Escreve um
; .ps1 temporario em vez de tentar aninhar aspas powershell/cmd/nsis direto
; na linha de comando -- essa combinacao ja causou bugs sutis de escaping
; nesta mesma sessao (ver historico do build-runtime.ps1/em-dash).
;
; IMPORTANTE: este instalador e 32-bit, entao o powershell que ele dispara
; tambem e 32-bit -- e Get-Process(...).Path de um processo 64-bit vem VAZIO
; nesse caso (o filtro nunca casava e o backend antigo seguia rodando, com
; exit code 0 escondendo a falha). Get-CimInstance Win32_Process enxerga os
; dois. O delimitador do texto e crase porque ele contem aspas simples e duplas.
!macro StopInstalledBackend DIR
    FileOpen $1 "$TEMP\odessa-stop-running.ps1" w
    FileWrite $1 `Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | Where-Object { $$_.ExecutablePath -like "${DIR}*" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n`
    FileClose $1
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\odessa-stop-running.ps1"'
    Delete "$TEMP\odessa-stop-running.ps1"
    Sleep 1500
!macroend

Function .onInit
    ReadRegStr $0 HKCU "Software\OdessaStudio" "InstallDir"
    StrCmp $0 "" done
    IfFileExists "$0\uninstall.exe" 0 done
        DetailPrint "Instalacao existente detectada em $0 -- encerrando processo em uso antes de atualizar..."
        !insertmacro StopInstalledBackend "$0"
    done:
FunctionEnd

Section "Instalar"
    ; Atualizacao: guarda server\data (personas, configs, edicoes de video --
    ; dados do USUARIO nesta maquina) antes de copiar os arquivos do programa e
    ; devolve depois. O stage traz os dados-padrao do repo, que so devem valer
    ; numa instalacao nova. robocopy sai com codigo != 0 mesmo em sucesso.
    StrCpy $R0 "$TEMP\odessa-userdata-bak"
    RMDir /r "$R0"
    StrCpy $R1 "0"
    IfFileExists "$INSTDIR\server\data\*.*" 0 skip_backup
        DetailPrint "Preservando dados do usuario (server\data)..."
        nsExec::ExecToLog 'robocopy "$INSTDIR\server\data" "$R0" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
        StrCpy $R1 "1"
    skip_backup:

    SetOutPath "$INSTDIR"
    File /r "${STAGE_DIR}\*.*"

    StrCmp $R1 "1" 0 skip_restore
        DetailPrint "Restaurando dados do usuario..."
        nsExec::ExecToLog 'robocopy "$R0" "$INSTDIR\server\data" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
        RMDir /r "$R0"
    skip_restore:

    CreateDirectory "$SMPROGRAMS\Odessa Studio"
    CreateShortcut "$SMPROGRAMS\Odessa Studio\Odessa Studio.lnk" "$INSTDIR\${APP_EXE_TARGET}" "" "$INSTDIR\favicon.ico" 0 SW_SHOWNORMAL "" "Abrir o Odessa Studio"
    CreateShortcut "$SMPROGRAMS\Odessa Studio\Desinstalar.lnk" "$INSTDIR\uninstall.exe"
    CreateShortcut "$DESKTOP\Odessa Studio.lnk" "$INSTDIR\${APP_EXE_TARGET}" "" "$INSTDIR\favicon.ico" 0 SW_SHOWNORMAL "" "Abrir o Odessa Studio"

    WriteUninstaller "$INSTDIR\uninstall.exe"
    WriteRegStr HKCU "Software\OdessaStudio" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
    WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
    ; Encerra o backend se estiver rodando, para nao deixar processo orfao
    ; nem travar a remocao de arquivos em uso. (O taskkill por WINDOWTITLE que
    ; ficava aqui nunca casava: o backend roda oculto, sem janela.)
    !insertmacro StopInstalledBackend "$INSTDIR"

    Delete "$SMPROGRAMS\Odessa Studio\Odessa Studio.lnk"
    Delete "$SMPROGRAMS\Odessa Studio\Desinstalar.lnk"
    RMDir "$SMPROGRAMS\Odessa Studio"
    Delete "$DESKTOP\Odessa Studio.lnk"

    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "${UNINST_KEY}"
    DeleteRegKey HKCU "Software\OdessaStudio"
SectionEnd
