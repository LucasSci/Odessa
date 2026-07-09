# Odessa local dev handoff

Este guia retoma o projeto sem depender da Hostinger. O modo local usa dois
processos: FastAPI em `http://localhost:8000` e Vite em
`http://localhost:3000`.

## Estado atual

- Branch de trabalho: `main`.
- Hospedagem Hostinger nao e necessaria para desenvolver ou testar localmente.
- O frontend chama o backend local pelo proxy do Vite para `/api`, `/auth`,
  `/obs`, `/ocr`, `/webhooks` e `/agent`.
- O CaptureStudio usa `/ocr/ingest` como rota central de OCR para automacao; o
  backend FastAPI local tambem expoe essa rota.
- `design-mockups/` contem os mockups Odessa Studio 2.0 herdados do trabalho no
  Claude: Inicio, Palco e Diretora IA. Eles estao preservados como referencia e
  ainda nao foram integrados ao React.

## Setup

Rode uma vez:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1
```

O script:

- instala dependencias npm quando `node_modules` nao existe;
- cria `venv` quando necessario;
- instala `server\requirements-local.txt` por padrao;
- cria `.env` local a partir de `.env.example` quando `.env` nao existe;
- gera um `ODESSA_SESSION_SECRET` local.

Credencial local padrao criada pelo setup:

- email: `lucasbatista.c.l@gmail.com`
- senha: `troque-esta-senha`

Se preferir outra senha, edite `ODESSA_ADMIN_PASSWORD` no `.env`.

O setup padrao evita pacotes pesados como EasyOCR/Kokoro para nao travar a
retomada local. Para instalar o pacote completo depois:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -Full
```

Use Python 3.11 ou 3.12. Python 3.13+ ainda pode quebrar dependencias nativas.

## Rodar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1
```

URLs principais:

- painel: `http://localhost:3000`
- overlay OBS: `http://localhost:3000/#overlay`
- captura/OCR: `http://localhost:3000/#capture`
- health backend: `http://localhost:8000/health`

Tambem da para iniciar partes separadas:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1 -Backend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1 -FrontendOnly
```

## Central de IA e chat autonomo

A aba `Diretora IA` agora funciona como cockpit operacional da live. Antes de
ligar envio real no chat, confira:

- `Prontidao da Live`: Gemini, OCR, OBS, Agente Local, alvo visual e autonomia.
- `Chat Autonomo`: modo dry-run/real, cooldown, limite por minuto e confianca minima.
- `Acoes Pendentes`: fila publica com aprovar, editar, enviar agora e descartar.
- CTA `Calibrar chat`: leva direto para o alvo visual usado pelo agente local.

Estados visuais:

- `pronto`: envio real pode operar se a Diretora estiver ligada.
- `atencao`: falta algum ajuste, mas o cockpit ainda pode operar em modo seguro.
- `bloqueado`: existe impedimento para envio real.
- `simulado`: dry-run ativo; nada publico deve ser enviado.

O cockpit tambem mostra a ultima resposta enviada, a ultima bloqueada e o motivo
do bloqueio. Use isso para descobrir rapidamente onde um erro aconteceu durante
a rodada.

## Modo simulado

Para trabalhar sem chaves externas, mantenha no `.env`:

```env
ENABLE_LOCAL_FALLBACK=true
SIMULATION_MODE=true
ENABLE_TTS=false
TTS_SIMULATION_MODE=true
```

OBS pode ficar apontado para `ws://localhost:4455`. Se o OBS nao estiver aberto,
o painel deve continuar utilizavel, apenas mostrando o estado offline da conexao.

## Testes

```powershell
npm test -- --run
npm run test:backend
```

Testes recomendados para a live simulada e para o cockpit:

```powershell
npm run build
npm test -- --run src/core/liveSimulation.test.ts src/core/liveAutonomyGovernor.test.ts src/core/chatAutomationApi.test.ts src/core/actionExecutor.test.ts src/core/chatReplyQueue.test.ts src/core/liveReadinessSupervisor.test.ts
npm run simulate:live
```

O script `npm run simulate:live` executa o caminho:

```text
OCR fake -> evento -> decisao -> governador -> fila -> executor -> cloud-agent
```

Ele nao depende de Tango, OBS nem OCR real. Use este fluxo para reproduzir uma
conversa com chat e detectar regressao em cooldown, duplicidade, baixa confianca
de OCR e envio sem alvo visual.

Relatorio detalhado das alteracoes recentes:

- `docs/ai-live-operations-report.md`

Se o backend ainda nao estiver preparado, rode o setup primeiro. Artefatos locais
como `.env`, `venv`, `server/runtime` e modelos `*.traineddata` nao entram no Git.
