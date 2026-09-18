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
3. `makensis desktop/odessa.nsi` — compila `desktop/build/OdessaStudioSetup.exe`
   usando a Modern UI 2 do NSIS (tela de boas-vindas, diretório, progresso e
   finalização com imagens próprias — ver "Visual do instalador" abaixo).
4. Assina o `.exe` gerado com o certificado autoassinado do projeto (ver
   "Assinatura do instalador" abaixo) — best-effort, se o certificado ou o
   `signtool.exe` não forem encontrados, o build continua e só avisa.

Para uma reconstrução rápida só do app (sem tocar no runtime Python, que é a
parte lenta):

```powershell
.\desktop\build-installer.ps1 -SkipRuntimeBuild
```

### Erro "arquivo não está assinado digitalmente" / `UnauthorizedAccess`

Se rodar `.\build-installer.ps1` (ou qualquer `.ps1` deste projeto) der um
erro assim:

```
.\build-installer.ps1 não pode ser carregado. O arquivo ... não está
assinado digitalmente. Não é possível executar este script no sistema
atual. ... CategoryInfo : ErrodeSegurança ... FullyQualifiedErrorId :
UnauthorizedAccess
```

Não é um bug do script — é o Windows bloqueando scripts baixados da
internet. Quando você baixa o `.zip` do GitHub (botão "Code → Download
ZIP") e extrai, o Windows marca cada arquivo como "de origem
desconhecida" (Mark of the Web), e o PowerShell recusa rodar `.ps1` não
assinado vindo dessa marca — mesmo que o conteúdo seja o mesmo do repo.

**Resolve em dois passos**, no PowerShell, dentro da pasta onde extraiu o
projeto (ajuste o caminho pro seu):

```powershell
Get-ChildItem -Path "C:\caminho\onde\voce\extraiu\Odessa-main" -Recurse | Unblock-File
```

Isso remove a marca de "bloqueado" de todos os arquivos da pasta extraída
— seguro, já que você mesmo baixou o `.zip` e confia no conteúdo.

Se o mesmo erro aparecer de novo depois disso, sua política de execução
do PowerShell está mais restritiva (`Restricted`). Rode isto **antes** de
chamar o script — só afeta a sessão atual do terminal, não muda nada
permanente no sistema:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

Depois dos dois passos, `.\desktop\build-installer.ps1` deve rodar
normalmente.

## Visual do instalador

As telas usam a Modern UI 2 do NSIS com duas imagens próprias em
`desktop/assets/installer/` (`welcome.bmp` — barra lateral das telas de boas-
vindas/conclusão — e `header.bmp` — topo das telas de diretório/progresso),
geradas a partir da própria paleta de cores do app (`src/index.css`: fundo
escuro + gradiente azul→ciano) e do ícone em `public/favicon.ico`. Elas já
ficam versionadas no repo; só é preciso rodar de novo se quiser mudar o visual:

```powershell
.\desktop\generate-installer-art.ps1
```

## Atualizar uma instalação existente

Rodar o mesmo instalador de novo numa máquina que já tem o Odessa Studio
**atualiza em vez de duplicar**: o `InstallDirRegKey` reaproveita a mesma
pasta, e `File /r` sobrescreve só os arquivos do programa — nada em
`$INSTDIR\.env` é tocado (segredos/sessão continuam os mesmos).

Se o app estiver aberto no momento, o instalador detecta a instalação
existente (`Function .onInit` em `odessa.nsi`) e encerra o processo Python
rodando a partir daquela pasta especificamente (nunca um Python de outro
programa) antes de copiar os arquivos novos — evita falha por DLL/exe em uso.
Isso torna o ciclo "mudei o código → `.\desktop\build-installer.ps1
-SkipRuntimeBuild` → rodar o instalador de novo" seguro mesmo com o app
aberto.

## Assinatura do instalador

O instalador é assinado com um certificado **autoassinado** próprio do
projeto (não emitido por uma autoridade certificadora pública). Isso:

- **Não remove** o aviso do SmartScreen ("O Windows protegeu o computador")
  para quem baixa o instalador sem mais nada — isso só acontece com um
  certificado pago de uma CA reconhecida (e mesmo assim pode levar tempo até
  ganhar reputação, exceto com certificado EV).
- **Troca "Editor desconhecido" por "Odessa Studio"** e garante que o arquivo
  não foi alterado depois de compilado, em qualquer máquina onde o
  certificado público for importado como confiável antes de instalar:

  ```powershell
  .\desktop\trust-cert.ps1
  ```

  (usa `desktop/codesign/OdessaStudio-CodeSign.cer`, que é versionado no repo
  — só a chave privada em `desktop/build/codesign/` fica de fora do git).

O certificado é gerado automaticamente na primeira vez que
`build-installer.ps1` roda (`generate-codesign-cert.ps1`, válido por 10 anos)
e reaproveitado nos builds seguintes. Para gerar um novo (ex.: se a chave
privada vazar), rode `.\desktop\generate-codesign-cert.ps1 -Force` e depois
rode `.\desktop\trust-cert.ps1` de novo em cada máquina de destino.

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
  3. Espera `/health` responder (até 45s) e abre `http://localhost:8000` no
     navegador padrão (não `127.0.0.1` — parte do frontend monta URLs de API
     com o literal `localhost`, então abrir pelo IP causa erro de CORS).
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
