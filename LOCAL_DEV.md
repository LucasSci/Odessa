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

Se o backend ainda nao estiver preparado, rode o setup primeiro. Artefatos locais
como `.env`, `venv`, `server/runtime` e modelos `*.traineddata` nao entram no Git.
