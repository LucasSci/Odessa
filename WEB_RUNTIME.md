# Desenvolvimento local

## Pré-requisitos

- Node.js 22+
- Python 3.11+
- (Opcional) OBS Studio para testar o overlay

## Instalar dependências

```powershell
npm install
python -m venv venv
venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

## Configurar variáveis de ambiente

```powershell
copy .env.example .env
```

Edite `.env` e configure pelo menos:

```env
ODESSA_ADMIN_PASSWORD=troque-esta-senha
ODESSA_SESSION_SECRET=gere-um-segredo-longo
```

## Rodar em dev

```powershell
# Terminal 1 — API Python (porta 8000)
npm run dev:api

# Terminal 2 — Frontend Vite (porta 3000)
npm run dev
```

Acesse `http://localhost:3000`.

O Vite faz proxy de `/api/*` para `http://127.0.0.1:8000` automaticamente (configurado em `vite.config.ts`).

## Overlay no OBS (dev)

Aponte a Browser Source para:

```
http://localhost:3000/#overlay
```

## Build local

```powershell
npm run build
```

O frontend compilado fica em `dist/`. Para servir localmente via Node.js:

```powershell
node hostinger-server.mjs
```

Acesse `http://localhost:8000`.

## Testes

```powershell
# Vitest (frontend + core)
npm test

# pytest (backend Python)
npm run test:backend
```

## Notas

- Em dev, o `ODESSA_COOKIE_SECURE` deve ser `false` (HTTP).
- `ODESSA_ALLOWED_ORIGINS` aceita múltiplas origens separadas por vírgula.
- O HMR pode ser desabilitado via `DISABLE_HMR=true` (usado pelo Claude Code para evitar flickering durante edições).
