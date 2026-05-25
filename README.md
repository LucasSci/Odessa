# Odessa

Sistema de persona virtual para lives — reproduz clipes de vídeo em resposta a presentes, comentários e agendamentos, de forma automática e em tempo real.

## O que é

A Odessa é um app web (React + Node.js) que atua como um player inteligente de vídeo para lives no TikTok Live. Através de um editor visual de fluxo (**ReactiveFlow**), você conecta clipes de vídeo a gatilhos (presente, palavra-chave no chat, tempo) e a Odessa cuida de reproduzir a sequência certa no momento certo, sem intervenção manual.

O OBS aponta uma **Browser Source** para a URL do overlay, e a Odessa gerencia qual vídeo tocar — incluindo looping do idle, transições suaves e retorno ao idle depois de cada reação.

## Arquitetura

```
┌─────────────────────────────────┐
│  Hostinger (Node.js Web App)    │
│                                 │
│  hostinger-server.mjs           │  ← servidor único: serve dist/ + API
│  api/[...path].js               │  ← handlers de vídeo, auth, automação
│  dist/                          │  ← frontend React (gerado pelo Vite)
│  public/odessa-schedules.json   │  ← config de agendamentos (estático)
│                                 │
│  KV store: ~/odessa-data/       │  ← persona_config, estado de vídeo
└──────────────┬──────────────────┘
               │ HTTPS
┌──────────────▼──────────────────┐
│  OBS (máquina da live)          │
│                                 │
│  Browser Source → /#overlay     │  ← PersonaOverlay.tsx
│    polling /api/video/state     │    a cada 500ms
│    dispara agendamentos         │    client-side
└─────────────────────────────────┘
```

**Stack principal (produção):**

| Camada | Tecnologia |
|---|---|
| Servidor | Node.js 22 + `hostinger-server.mjs` |
| Frontend | React 19 + Vite + Tailwind CSS 4 |
| Persistência | KV em disco (`~/odessa-data/data/kv.json`) |
| Hospedagem | Hostinger Business Web Hosting |
| Domínio | configurado no hPanel |

**Stack local (dev):**

| Camada | Tecnologia |
|---|---|
| Dev server | Vite (porta 3000) |
| API | Python FastAPI / uvicorn (porta 8000) |
| OCR | Tesseract.js + Browser TextDetector |

## Funcionalidades

- **ReactiveFlow** — editor visual de fluxo; conecta vídeos a gatilhos (presente, palavra, tempo)
- **Agendamentos** — disparam vídeos automaticamente em intervalos configurados; executados client-side pela PersonaOverlay
- **OCR/Captura** — lê chat ao vivo via captura de tela (CaptureStudio) para identificar comentários e gatilhos
- **Reconhecimento visual de presentes** — identifica presentes do TikTok por perceptual hash
- **OdessaLiveCenter** — painel central de controle da live
- **PersonaStudio** — configuração do perfil e comportamento da persona
- **Biblioteca de vídeos** — upload, organização e pré-visualização dos clipes

## Estrutura de pastas

```
odessa/
├── api/                    # Handlers de API (Hostinger/Vercel-style)
│   ├── [...path].js        # Catch-all (roteamento principal)
│   ├── auth/               # login, logout, me
│   ├── ocr/                # ingestão de OCR
│   └── v1/                 # endpoints versionados (video, workflow)
├── assets/
│   ├── branding/           # ícones e logotipos
│   └── videos/             # clipes de vídeo locais (dev)
├── electron/               # Runtime desktop (Electron — opcional)
├── public/
│   ├── odessa-schedules.json  # config de agendamentos servida estaticamente
│   └── timer-worker.js        # worker para timers no overlay
├── scripts/                # scripts utilitários (PowerShell, Python)
├── server/                 # Backend Python (FastAPI — dev local)
│   ├── api/v1/endpoints/   # rotas da API Python
│   ├── core/               # auth, db, config manager
│   ├── services/           # AI, OCR, vídeo, automação, workflow
│   └── tests/              # testes Python
├── src/                    # Frontend React
│   ├── core/               # engine de automação client-side
│   ├── lib/                # utilitários (api, obs, tts)
│   ├── components/         # componentes UI compartilhados
│   ├── PersonaOverlay.tsx  # browser source do OBS
│   ├── ReactiveFlowBoard.tsx # editor de fluxo visual
│   ├── OdessaLiveCenter.tsx  # painel da live
│   └── CaptureStudio.tsx   # captura + OCR
├── workflows/n8n/          # workflows n8n (opcional)
├── hostinger-server.mjs    # servidor Node.js de produção
├── vite.config.ts          # build config + injeção de schedules
└── CLAUDE.md               # instruções para o Claude Code
```

## Setup local (dev)

### Pré-requisitos

- Node.js 22+
- Python 3.11+
- OBS Studio (para testar o overlay)

### Instalar

```powershell
npm install
python -m venv venv
venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

### Configurar

```powershell
copy .env.example .env
```

Edite `.env` e configure pelo menos:
- `ODESSA_ADMIN_PASSWORD` — senha do painel admin
- `ODESSA_SESSION_SECRET` — segredo aleatório para sessões

### Rodar

```powershell
# Terminal 1 — API Python
npm run dev:api

# Terminal 2 — Frontend Vite
npm run dev
```

Acesse `http://localhost:3000`.

## Deploy (Hostinger)

### Build + zip

```powershell
npx vite build
Compress-Archive -Path dist, api, public, src, workflows, package.json, package-lock.json, hostinger-server.mjs, vite.config.ts, tsconfig.json, .hostinger.json, index.html -DestinationPath deploy.zip -Force
```

### Enviar via MCP

Use o tool `mcp__hostinger-mcp__hosting_deployJsApplication` com:
- `archivePath`: caminho absoluto para `deploy.zip`
- `domain`: `SEU-DOMINIO.hostingersite.com`

### Variáveis de ambiente (hPanel)

Configure em **Websites → Manage → Environment Variables**:

```env
NODE_ENV=production
ODESSA_PUBLIC_URL=https://SEU-DOMINIO.hostingersite.com
ODESSA_ADMIN_PASSWORD_HASH=<hash bcrypt da senha>
ODESSA_SESSION_SECRET=<segredo longo e aleatório>
ODESSA_COOKIE_SECURE=true
ODESSA_COOKIE_SAMESITE=Lax
```

### Verificar

```
https://SEU-DOMINIO.hostingersite.com/api/health
https://SEU-DOMINIO.hostingersite.com/api/v1/video/state
https://SEU-DOMINIO.hostingersite.com/#overlay
```

## Configuração do OBS

1. Adicione uma **Browser Source** na cena da live
2. URL: `https://SEU-DOMINIO.hostingersite.com/#overlay`
3. Resolução: `1920×1080` (ou a resolução da cena)
4. Marque **"Refresh browser when scene becomes active"**

## Autenticação (dev/testes)

Use o email e a senha configurados em `ODESSA_ADMIN_PASSWORD` (ou `ODESSA_ADMIN_PASSWORD_HASH`) no `.env`.

O token de sessão vem no campo `sessionToken` da resposta de login e vai no header:
```
Authorization: Bearer <token>
```

## Testes

```powershell
# Frontend (Vitest)
npm test

# Backend (pytest)
npm run test:backend
```

## Observações

- **Agendamentos rodam client-side** — a `PersonaOverlay.tsx` lê `public/odessa-schedules.json` e dispara os gatilhos via `POST /api/video/trigger` sem depender do processo Node.js do servidor.
- **O processo Node.js na Hostinger não reinicia automaticamente** após deploy estático. Mudanças de API só entram em vigor após reinício manual via hPanel.
- **Não suba `.env` nem arquivos com senhas** para o repositório.
