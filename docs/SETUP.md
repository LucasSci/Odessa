# Setup e desenvolvimento local

## Pré-requisitos

- Node.js 22+
- Python 3.11 ou 3.12 (Python 3.13+ pode quebrar dependências nativas)
- (Opcional) OBS Studio para testar o overlay

## Setup automático

Rode uma vez:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1
```

O script:
- instala dependências npm quando `node_modules` não existe;
- cria `venv` quando necessário;
- instala `server\requirements-local.txt` por padrão;
- cria `.env` local a partir de `.env.example` quando `.env` não existe;
- gera um `ODESSA_SESSION_SECRET` local.

Credencial local padrão criada pelo setup:
- email: `lucasbatista.c.l@gmail.com`
- senha: `troque-esta-senha`

Para instalar o pacote completo (EasyOCR/Kokoro etc.):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -Full
```

## Setup manual

```powershell
npm install
python -m venv venv
venv\Scripts\python.exe -m pip install -r server\requirements.txt
copy .env.example .env
```

Edite `.env` e configure pelo menos:
- `ODESSA_ADMIN_PASSWORD` — senha do painel admin
- `ODESSA_SESSION_SECRET` — segredo aleatório para sessões

## Rodar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1
```

URLs principais:
- painel: `http://localhost:3000`
- overlay OBS: `http://localhost:3000/#overlay`
- captura/OCR: `http://localhost:3000/#capture`
- health backend: `http://localhost:8000/health`

Também dá para iniciar partes separadas:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1 -Backend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1 -FrontendOnly
```

Ou manualmente em dois terminais:

```powershell
# Terminal 1 — API Python (porta 8000)
npm run dev:api

# Terminal 2 — Frontend Vite (porta 3000)
npm run dev
```

O Vite faz proxy de `/api/*` para `http://127.0.0.1:8000` automaticamente
(configurado em `vite.config.ts`).

## Atalho do Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-odessa-shortcut.ps1 -Desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-odessa-shortcut.ps1 -StartMenu
```

Use `-Force` para substituir atalhos existentes.

## Modo simulado (sem chaves externas)

Para trabalhar sem chaves externas, mantenha no `.env`:

```env
ENABLE_LOCAL_FALLBACK=true
SIMULATION_MODE=true
ENABLE_TTS=false
TTS_SIMULATION_MODE=true
```

OBS pode ficar apontado para `ws://localhost:4455`. Se o OBS não estiver
aberto, o painel continua utilizável, apenas mostrando o estado offline.

## Build local

```powershell
npm run build
```

O frontend compilado fica em `dist/`. Para servir localmente via Node.js:

```powershell
node hostinger-server.mjs
```

## Notas

- Em dev, `ODESSA_COOKIE_SECURE` deve ser `false` (HTTP).
- `ODESSA_ALLOWED_ORIGINS` aceita múltiplas origens separadas por vírgula.
- O HMR pode ser desabilitado via `DISABLE_HMR=true`.
- Artefatos locais como `.env`, `venv`, `server/runtime` e modelos
  `*.traineddata` não entram no Git.
