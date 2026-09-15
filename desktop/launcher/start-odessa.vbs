' Wrapper minimo para rodar start-odessa.ps1 sem mostrar uma janela de console.
' E o alvo real do atalho instalado (Menu Iniciar / Area de Trabalho).
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1Path = scriptDir & "\start-odessa.ps1"

Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
shell.Run cmd, 0, False
