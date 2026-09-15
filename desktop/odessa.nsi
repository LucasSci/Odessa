; Instalador do Odessa Studio (NSIS).
; Compila com: makensis desktop\odessa.nsi
; Espera que desktop\build\stage ja exista (rode build-runtime.ps1 + stage.ps1 antes).

!define APP_NAME "Odessa Studio"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "Odessa"
!define APP_EXE_TARGET "launcher\start-odessa.vbs"
!define STAGE_DIR "build\stage"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OdessaStudio"

Name "${APP_NAME}"
OutFile "build\OdessaStudioSetup.exe"
InstallDir "$LOCALAPPDATA\OdessaStudio"
InstallDirRegKey HKCU "Software\OdessaStudio" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Icon "..\public\favicon.ico"
UninstallIcon "..\public\favicon.ico"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

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

    MessageBox MB_OK "Instalacao concluida!$\n$\nO Odessa Studio precisa do Ollama (inteligencia local) e do OBS Studio (transmissao) instalados separadamente -- o proprio app verifica isso na primeira execucao e abre as paginas de download se faltar algo.$\n$\nUse o atalho criado no Menu Iniciar ou na Area de Trabalho para abrir."
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
