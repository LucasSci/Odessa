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
    ; O launcher (start-odessa.ps1) fica vivo como supervisor e reergueria o
    ; backend logo depois de morto -- em plena troca de arquivos. Sai primeiro.
    FileWrite $1 `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $$_.CommandLine -like "*${DIR}\launcher\start-odessa.ps1*" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n`
    FileWrite $1 `Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | Where-Object { $$_.ExecutablePath -like "${DIR}*" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n`
    FileClose $1
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\odessa-stop-running.ps1"'
    Delete "$TEMP\odessa-stop-running.ps1"
    Sleep 1500
!macroend

; Seguranca do diretorio: o desinstalador remove a pasta de instalacao
; inteira, entao ela TEM que ser uma pasta propria do app. Sem isso, escolher
; "C:\Users\eu\Documentos" na pagina de diretorio faria o desinstalador apagar
; os documentos. Exige que o ultimo nome da pasta seja OdessaStudio.
!include "FileFunc.nsh"
!insertmacro GetFileName
!insertmacro un.GetFileName

Function .onVerifyInstDir
    ${GetFileName} "$INSTDIR" $R9
    StrCmp $R9 "OdessaStudio" +2
        Abort
FunctionEnd

Function .onInit
    ReadRegStr $0 HKCU "Software\OdessaStudio" "InstallDir"
    StrCmp $0 "" done
    IfFileExists "$0\uninstall.exe" 0 done
        DetailPrint "Instalacao existente detectada em $0 -- encerrando processo em uso antes de atualizar..."
        !insertmacro StopInstalledBackend "$0"
    done:
FunctionEnd

Section "Instalar"
    ; Cinto e suspensorio: /D=... na linha de comando ignora a pagina de
    ; diretorio e o .onVerifyInstDir.
    ${GetFileName} "$INSTDIR" $R9
    StrCmp $R9 "OdessaStudio" +3
        DetailPrint "Pasta de instalacao invalida ($INSTDIR): o nome deve ser OdessaStudio."
        Abort "Pasta de instalacao invalida: o nome da pasta deve ser OdessaStudio."

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
        Pop $R2
        ; robocopy: 0-7 = sucesso; >= 8 = falha. Sem backup, nao mexe em nada.
        IntCmp $R2 8 backup_failed backup_ok backup_failed
        backup_failed:
            Abort "Nao foi possivel guardar seus dados antes da atualizacao (robocopy $R2). Nada foi alterado."
        backup_ok:
        StrCpy $R1 "1"
    skip_backup:

    ; Login do Tango: o perfil do navegador da bridge morava em
    ; server\runtime\chrome-debug-profile e era apagado a cada atualizacao
    ; (o Tango pedia login de novo). Move para fora da pasta do programa, onde
    ; o backend novo procura (BROWSER_PROFILES_DIR em server\config.py).
    IfFileExists "$INSTDIR\server\runtime\chrome-debug-profile\*.*" 0 skip_profile_move
    IfFileExists "$LOCALAPPDATA\Odessa\browser-profiles\chrome\*.*" skip_profile_move
        DetailPrint "Preservando o login do Tango (perfil do navegador da live)..."
        CreateDirectory "$LOCALAPPDATA\Odessa\browser-profiles"
        nsExec::ExecToLog 'robocopy "$INSTDIR\server\runtime\chrome-debug-profile" "$LOCALAPPDATA\Odessa\browser-profiles\chrome" /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS'
        Pop $R2
    skip_profile_move:

    ; server\runtime tambem e do usuario (config do OBS e da bridge, token,
    ; banco local): guarda e devolve como server\data.
    StrCpy $R3 "$TEMP\odessa-runtime-bak"
    RMDir /r "$R3"
    StrCpy $R4 "0"
    IfFileExists "$INSTDIR\server\runtime\*.*" 0 skip_runtime_backup
        DetailPrint "Preservando configuracoes locais (server\runtime)..."
        nsExec::ExecToLog 'robocopy "$INSTDIR\server\runtime" "$R3" /E /XD chrome-debug-profile /R:1 /W:1 /NFL /NDL /NJH /NJS'
        Pop $R2
        IntCmp $R2 8 skip_runtime_backup runtime_backup_ok skip_runtime_backup
        runtime_backup_ok:
        StrCpy $R4 "1"
    skip_runtime_backup:

    ; Remove o codigo antigo antes de copiar o novo: File /r so sobrescreve, e
    ; arquivos que sairam de uma versao ficariam para tras. Os dados do usuario
    ; ja estao guardados em $R0 e voltam abaixo; o .env fica na raiz e nao e tocado.
    RMDir /r "$INSTDIR\python"
    RMDir /r "$INSTDIR\dist"
    RMDir /r "$INSTDIR\launcher"
    RMDir /r "$INSTDIR\server"
    RMDir /r "$INSTDIR\tango_chat"

    SetOutPath "$INSTDIR"
    File /r "${STAGE_DIR}\*.*"

    StrCmp $R1 "1" 0 skip_restore
        DetailPrint "Restaurando dados do usuario..."
        nsExec::ExecToLog 'robocopy "$R0" "$INSTDIR\server\data" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
        RMDir /r "$R0"
    skip_restore:

    StrCmp $R4 "1" 0 skip_runtime_restore
        DetailPrint "Restaurando configuracoes locais..."
        nsExec::ExecToLog 'robocopy "$R3" "$INSTDIR\server\runtime" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
        Pop $R2
        RMDir /r "$R3"
    skip_runtime_restore:

    ; Reinstalacao depois de desinstalar mantendo os dados: devolve a copia.
    StrCmp $R1 "1" skip_reuse
    IfFileExists "$LOCALAPPDATA\Odessa\data-backup\data\*.*" 0 skip_data_reuse
        DetailPrint "Reaproveitando dados guardados na desinstalacao anterior..."
        nsExec::ExecToLog 'robocopy "$LOCALAPPDATA\Odessa\data-backup\data" "$INSTDIR\server\data" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
        Pop $R2
    skip_data_reuse:
    IfFileExists "$LOCALAPPDATA\Odessa\data-backup\.env" 0 skip_reuse
    IfFileExists "$INSTDIR\.env" skip_reuse
        CopyFiles /SILENT "$LOCALAPPDATA\Odessa\data-backup\.env" "$INSTDIR\.env"
    skip_reuse:

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

    ; Nunca apaga recursivamente uma pasta que nao seja a do app (registro
    ; adulterado, pasta movida...). Fora desse caso, remove so o que o
    ; instalador colocou.
    ${un.GetFileName} "$INSTDIR" $R9
    StrCmp $R9 "OdessaStudio" dir_ok
        MessageBox MB_OK|MB_ICONEXCLAMATION "A pasta de instalacao ($INSTDIR) nao se chama OdessaStudio; por seguranca, nada nela foi apagado. Remova-a manualmente se quiser." /SD IDOK
        Goto unreg
    dir_ok:

    ; Dados do usuario: no modo silencioso (/S) sempre guarda. Interativo:
    ; pergunta. A copia vai para fora da pasta que sera apagada.
    MessageBox MB_YESNO|MB_ICONQUESTION "Manter seus dados (personas, configuracoes, edicoes de video e o arquivo .env)?$\n$\nSim: uma copia fica em $LOCALAPPDATA\Odessa\data-backup e sera reaproveitada se voce reinstalar.$\nNao: tudo sera apagado." /SD IDYES IDNO skip_keep
        RMDir /r "$LOCALAPPDATA\Odessa\data-backup"
        CreateDirectory "$LOCALAPPDATA\Odessa\data-backup"
        IfFileExists "$INSTDIR\server\data\*.*" 0 no_data
            nsExec::ExecToLog 'robocopy "$INSTDIR\server\data" "$LOCALAPPDATA\Odessa\data-backup\data" /E /R:1 /W:1 /NFL /NDL /NJH /NJS'
            Pop $R2
        no_data:
        IfFileExists "$INSTDIR\.env" 0 skip_keep
            CopyFiles /SILENT "$INSTDIR\.env" "$LOCALAPPDATA\Odessa\data-backup\.env"
    skip_keep:

    RMDir /r "$INSTDIR"

    unreg:
    DeleteRegKey HKCU "${UNINST_KEY}"
    DeleteRegKey HKCU "Software\OdessaStudio"
SectionEnd
