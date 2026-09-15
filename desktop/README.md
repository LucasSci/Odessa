# Instalador desktop do Odessa Studio

Gera um instalador Windows (`OdessaStudioSetup.exe`) que empacota o backend
Python, o frontend buildado e um runtime Python completo (interpretador +
dependencias + Chromium do Playwright) — quem instala não precisa ter Python,
Node ou qualquer dependência de dev na máquina.

## O que NÃO é empacotado (e por quê)

- **Ollama** — os modelos de linguagem pesam vários GB cada; inviável embutir.
- **OBS Studio** — aplicativo completo de terceiros, com seu próprio instalador.

O launcher (`launcher/start-odessa.ps1`) verifica se cada um está presente na
primeira execução e, se não estiver, abre a página oficial de download no
navegador (uma única vez por instalação — não fica repetindo a cada abertura).

## Como gerar o instalador

Pré-requisitos no ambiente de build (não no ambiente de destino):
- NSIS (`winget install NSIS.NSIS`)
- Node/npm e o `venv` de dev já configurados (para rodar `npm run build`)
- Acesso à internet (baixa o Python embeddable, pip install, `playwright install chromium`)

```powershell
.\desktop\build-installer.ps1
```

Isso roda em sequência:
1. `build-runtime.ps1` — baixa o Python 3.12.10 embeddable, instala
   `desktop/requirements.txt` nele e baixa o Chromium do Playwright.
   Demorado (rede + instalação), mas só precisa rodar de novo se as
   dependências Python mudarem. Pule com `-SkipRuntimeBuild`.
2. `stage.ps1` — builda o frontend (`npm run build`) e monta
   `desktop/build/stage/` com tudo que vai pro instalador: `server/`,
   `tango_chat/`, `dist/`, `assets/`, o runtime Python e os scripts do
   launcher.
3. `makensis desktop/odessa.nsi` — compila `desktop/build/OdessaStudioSetup.exe`.

Para uma reconstrução rápida só do app (sem tocar no runtime Python, que é a
parte lenta):

```powershell
.\desktop\build-installer.ps1 -SkipRuntimeBuild
```

## `desktop/requirements.txt` vs `server/requirements*.txt`

Deliberadamente menor: sem `kokoro` (arrasta `torch`, ~490MB — TTS local fica
de fora, `edge-tts` continua disponível) e sem `pytest`/`pytest-asyncio`
(dependências de teste, não de runtime). Inclui `playwright`,
`playwright-stealth` e `aiohttp` (de `tango_chat/requirements.txt`), que
`server/requirements*.txt` não lista mas `tango_chat/tango_chat.py` importa
direto.

## Como o app instalado funciona

- Instala em `%LOCALAPPDATA%\OdessaStudio` (sem precisar de admin).
- O atalho (Menu Iniciar / Área de Trabalho) chama
  `launcher/start-odessa.vbs`, que roda `start-odessa.ps1` escondido (sem
  janela de console) — ele:
  1. Gera um `.env` com segredos aleatórios no primeiro uso.
  2. Sobe `python\python.exe -m uvicorn server.main:app --port 8000` em
     segundo plano (o próprio FastAPI já serve o frontend de `dist/`, ver
     `server/main.py` — um único processo basta).
  3. Espera `/health` responder (até 45s) e abre `http://127.0.0.1:8000` no
     navegador padrão.
  4. Verifica Ollama/OBS e abre as páginas de download se faltar algo.
- Logs em `%LOCALAPPDATA%\Odessa\logs\` (`odessa.log`, `backend.out.log`,
  `backend.err.log`) — útil pra diagnosticar se algo não subir numa máquina
  nova.
- Desinstalar remove `%LOCALAPPDATA%\OdessaStudio` inteiro, os atalhos e a
  entrada no Painel de Controle — os logs em `%LOCALAPPDATA%\Odessa\` não são
  removidos (ficam pra diagnóstico).

## Tentativa anterior (Electron)

Existiu uma tentativa anterior de empacotamento via Electron (`electron/`,
`installer/odessa-runtime.nsh`, `scripts/build-offline-installer.ps1`,
`scripts/build-signed-installer.ps1`, `certs/`) que chamava
`electron-builder` — pacote que já não existe em `package.json`. Já foi
removida do `main` numa limpeza anterior; este instalador (`desktop/`) é um
caminho novo e independente, sem depender de nada daquela tentativa.
