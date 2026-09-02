# Odessa

Sistema de persona virtual para lives (TikTok/Tango Live): um player inteligente
de vídeo que reage a presentes, comentários e agendamentos em tempo real,
controlado por um editor visual de fluxo (**ReactiveFlow**) e exibido como
Browser Source no OBS.

## O que é

A Odessa atua como um player inteligente de vídeo para lives. Através de um
editor visual de fluxo, você conecta clipes de vídeo a gatilhos (presente,
palavra-chave no chat, tempo) e a Odessa reproduz a sequência certa no momento
certo, sem intervenção manual. O OBS aponta uma **Browser Source** para o
overlay, e a Odessa gerencia qual vídeo tocar — incluindo looping do idle,
transições suaves e retorno ao idle após cada reação.

Além disso, a Odessa **conversa com o público automaticamente**: captura o chat
do Tango via bridge, responde com IA generativa (RouteLLM) usando a
personalidade da persona ativa, e reage a palavras-chave/presentes trocando de
vídeo.

## Funcionalidades

- **ReactiveFlow** — editor visual de fluxo; conecta vídeos a gatilhos (presente, palavra, tempo)
- **Perfis de IA (personas)** — múltiplas personas selecionáveis, cada uma com vídeos, fluxo, gatilhos e personalidade próprios
- **Conversa automática** — o chat responde com IA generativa, com governança anti-flood
- **Chat → gatilhos** — mensagens do chat disparam troca de vídeo por palavra-chave/presente
- **Geração de vídeo em tempo real** — interações do chat geram prompts e vídeos a partir do último frame da live, registrados no fluxo da persona
- **Bridge do Tango** — captura de chat e tela em tempo real (Playwright/CDP)
- **Agendamentos** — disparam vídeos automaticamente em intervalos configurados
- **OCR/Captura** — lê chat ao vivo via captura de tela (CaptureStudio)
- **OdessaLiveCenter** — painel central de controle da live
- **Biblioteca de vídeos** — upload, organização e pré-visualização dos clipes

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS 4 + TypeScript |
| Backend (dev/desktop) | Python FastAPI / uvicorn |
| Backend (produção) | Node.js (`hostinger-server.mjs` + `api/`) |
| Bridge do Tango | Python aiohttp (porta 7555) + Playwright/CDP |
| IA generativa | RouteLLM da Abacus.AI (compatível com OpenAI) |
| Persistência | KV em disco (`~/odessa-data/`) + SQLite (`server/runtime/`) |
| Hospedagem | Hostinger Business Web Hosting |

## Início rápido

```powershell
# 1. Setup (instala dependências, cria venv e .env)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1

# 2. Rodar (backend FastAPI + frontend Vite)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1
```

Acesse o painel em `http://localhost:3000`.

## Documentação

A documentação completa está em [`docs/`](docs/README.md):

| Documento | Conteúdo |
|---|---|
| [Arquitetura](docs/ARCHITECTURE.md) | Arquitetura, os 3 runtimes, fluxo de dados |
| [Setup](docs/SETUP.md) | Setup e execução em desenvolvimento local |
| [Deploy](docs/DEPLOY.md) | Build e deploy na Hostinger |
| [API](docs/API.md) | Referência dos endpoints |
| [OBS + Tango](docs/OBS-TANGO.md) | Configuração do OBS e da bridge do Tango |
| [Personas](docs/PERSONAS.md) | Perfis de persona e conversa com IA |
| [Geração de vídeo](docs/VIDEO-GEN.md) | Pipeline de geração de vídeo em tempo real |
| [Testes](docs/TESTING.md) | Como rodar os testes |
| [Changelog](docs/CHANGELOG.md) | Histórico de mudanças |

## Estrutura de pastas

```
odessa/
├── src/                    # Frontend React
│   ├── core/               # Engine de automação, IA, personas, governança
│   ├── lib/                # Utilitários (api, obs, tts)
│   ├── components/         # Componentes UI compartilhados
│   ├── OdessaLiveCenter.tsx  # Painel central da live
│   ├── PersonaOverlay.tsx  # Browser source do OBS
│   └── ReactiveFlowBoard.tsx # Editor de fluxo visual
├── server/                 # Backend Python (FastAPI)
│   ├── api/v1/endpoints/   # Rotas da API
│   ├── core/               # auth, config_manager, persona_manager
│   ├── services/           # AI, OCR, vídeo, automação, workflow
│   └── data/               # personas.json, persona_config.json
├── api/                    # Handlers Node de produção (Hostinger)
├── tango_chat/             # Bridge do Tango (porta 7555)
├── electron/               # Runtime desktop (Electron)
├── scripts/                # Scripts utilitários (PowerShell, Python)
├── workflows/n8n/          # Workflows n8n (opcional)
├── docs/                   # Documentação do projeto
└── assets/                 # Branding e vídeos locais (dev)
```

## Autenticação

Use o email e a senha configurados em `ODESSA_ADMIN_PASSWORD` (ou
`ODESSA_ADMIN_PASSWORD_HASH`) no `.env`. O token de sessão vem no campo
`sessionToken` da resposta de login e vai no header:

```
Authorization: Bearer <token>
```

## Testes

```powershell
npm test              # Frontend (Vitest)
npm run test:backend  # Backend (pytest)
npm run simulate:live # Simulação de live
```

## Observações

- **Não suba `.env` nem arquivos com senhas** para o repositório.
- **O processo Node.js na Hostinger não reinicia automaticamente** após deploy
  estático. Mudanças de API só entram em vigor após reinício manual via hPanel.
- **Agendamentos rodam client-side** — a `PersonaOverlay.tsx` lê
  `public/odessa-schedules.json` e dispara os gatilhos sem depender do processo
  Node.js do servidor.
