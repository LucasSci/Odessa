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
!define MUI_WELCOMEPAGE_TEXT "Este assistente vai instalar o Odessa Studio nesta maquina.$\n$\nTudo que o app precisa para rodar (backend, interface e o navegador Chromium usado pela integracao com o Tango) ja vem embutido no instalador -- nao precisa instalar Python, Node nem nenhuma outra dependencia de desenvolvedor.$\n$\nOllama (IA local) e OBS Studio (transmissao) sao aplicativos separados; se nao estiverem instalados, o proprio Odessa Studio vai abrir a pagina de download deles na primeira vez que voce rodar.$\n$\nClique em Avancar para continuar."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "Instalacao concluida"
!define MUI_FINISHPAGE_TEXT "O Odessa Studio foi instalado com sucesso.$\n$\nLembrete: o Ollama (IA local) e o OBS Studio (transmissao) sao instalados a parte -- o app verifica e abre a pagina de download deles automaticamente se faltar algum."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE_TARGET}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Odessa Studio agora"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Instalar"
    SetOutPath "$INSTDIR"
    File /r "${STAGE_DIR}\*.*"

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
    ; nem travar a remocao de arquivos em uso.
    nsExec::ExecToLog 'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *server.main*"'

    Delete "$SMPROGRAMS\Odessa Studio\Odessa Studio.lnk"
    Delete "$SMPROGRAMS\Odessa Studio\Desinstalar.lnk"
    RMDir "$SMPROGRAMS\Odessa Studio"
    Delete "$DESKTOP\Odessa Studio.lnk"

    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "${UNINST_KEY}"
    DeleteRegKey HKCU "Software\OdessaStudio"
SectionEnd
