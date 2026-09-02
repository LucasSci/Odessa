# Arquitetura do Odessa

## Visão geral

O Odessa é um sistema de persona virtual para lives. Ele reproduz clipes de
vídeo em resposta a presentes, comentários e agendamentos, de forma automática
e em tempo real. O OBS aponta uma **Browser Source** para o overlay, e o Odessa
gerencia qual vídeo tocar — incluindo looping do idle, transições suaves e
retorno ao idle após cada reação.

## Os 3 runtimes

O projeto tem **três formas de execução** que compartilham o mesmo frontend,
mas usam backends diferentes:

| Runtime | Backend | Uso |
|---|---|---|
| **Local dev** | Python FastAPI (`server/`) porta 8000 + Vite porta 3000 | Desenvolvimento |
| **Desktop (Electron)** | Python FastAPI (`server/`) — `electron/main.ts` faz spawn do uvicorn | App instalado |
| **Produção (Hostinger)** | Node.js (`hostinger-server.mjs` + `api/[...path].js`) | Deploy web |

> **Nota de arquitetura:** as features recentes (bridge do Tango, personas,
> conversa com IA via RouteLLM) foram construídas **apenas no backend Python**.
> O backend canônico recomendado é o **Python FastAPI**; o handler Node de
> produção é legado e deve ser aposentado gradualmente.

## Fluxo de dados (chat → reação)

```
Chat do Tango
      │  (MutationObserver na bridge)
      ▼
Bridge do Tango (tango_chat/tango_chat.py, porta 7555)
      │  SSE /messages
      ▼
Frontend (TangoChatPanel.tsx)
      │  routeChatToTriggers() → POST /api/automation/ingest
      │  handleAutoTriggerAi() → POST /api/ai/respond (IA generativa)
      ▼
Backend Python (server/)
      ├─ TriggerEngine (palavra-chave/presente → troca de vídeo)
      └─ AIService (RouteLLM → resposta conversacional)
      │
      ▼
Player de vídeo (overlay no OBS)
```

### Componentes do fluxo

1. **Bridge do Tango** — subprocesso headless Chromium (Playwright) que captura
   o chat ao vivo via `MutationObserver` e transmite a tela via CDP Screencast.
   Expõe um servidor aiohttp na porta 7555 com endpoints `/messages` (SSE),
   `/history`, `/screenshot`, `/send`, `/connect`, `/disconnect`.
2. **Trigger engine** (`server/services/automation/`) — casa eventos
   (comentário, presente) com gatilhos configurados no fluxo e dispara a troca
   de vídeo. Determinístico e rápido.
3. **IA conversacional** (`server/services/ai_service.py`) — gera respostas
   naturais usando a RouteLLM da Abacus.AI (compatível com OpenAI), com
   fallback para Gemini e para respostas prontas locais.
4. **Governança anti-flood** (`src/core/chatConversationGovernor.ts`) — aplica
   cooldown global, limite por minuto, cooldown por usuário e anti-flood de
   repetição antes de responder.

## Estrutura de diretórios

```
Odessa/
├── src/                      # Frontend React 19 + Vite + Tailwind 4 + TS
│   ├── App.tsx, main.tsx, index.css, types.ts
│   ├── OdessaLiveCenter.tsx  # Painel central de controle da live
│   ├── CaptureStudio.tsx     # Captura + OCR
│   ├── ReactiveFlowBoard.tsx # Editor de fluxo visual
│   ├── TangoChatPanel.tsx    # Painel do chat do Tango
│   ├── PersonaOverlay.tsx    # Browser source do OBS
│   ├── components/           # Componentes UI compartilhados
│   ├── core/                 # Engine de automação, IA, personas, governança
│   └── lib/                  # Utilitários (api, obs, tts, memory)
├── server/                   # Backend Python FastAPI (dev + desktop)
│   ├── main.py, config.py, models.py
│   ├── api/v1/               # Rotas da API (15 módulos de endpoints)
│   ├── core/                 # auth, config_manager, persona_manager, database
│   ├── services/             # ai, obs, tts, video, automation/, ocr/
│   └── data/                 # personas.json, persona_config.json
├── api/                      # Handlers Node de produção (Hostinger)
├── tango_chat/               # Bridge do Tango (aiohttp porta 7555)
├── electron/                 # Runtime desktop (Electron)
├── scripts/                  # Scripts utilitários (PowerShell, Python)
├── workflows/n8n/            # Workflows n8n (opcional)
├── docs/                     # Documentação do projeto
├── assets/                   # Branding e vídeos locais (dev)
└── public/                   # Arquivos estáticos servidos pelo Vite
```

## Módulos principais do backend

| Módulo | Responsabilidade |
|---|---|
| `server/core/persona_manager.py` | Perfis de IA (personas), cada um com vídeos, fluxo, gatilhos e personalidade |
| `server/core/config_manager.py` | Carrega/salva a config da persona ativa (com cache) |
| `server/services/ai_service.py` | IA generativa (RouteLLM/OpenAI/Gemini) com router e fallback |
| `server/services/automation/engine.py` | Trigger engine (casa eventos com gatilhos) |
| `server/services/bridge_manager.py` | Gerencia o processo da bridge do Tango |
| `server/services/video_service.py` | Player de vídeo e estado do fluxo |
| `server/services/video_gen/` | Pipeline de geração de vídeo em tempo real (prompt + frame → vídeo → fluxo) |

## Decisões de arquitetura

- **Backend canônico:** Python FastAPI (concentra as features novas).
- **Gatilhos determinísticos:** o trigger engine do backend cuida de
  palavra-chave/presente → vídeo; a IA fica só com a conversa.
- **IA com fallback:** RouteLLM → Gemini → respostas prontas locais, para o
  chat nunca parar.
- **Personas por arquivo:** índice `personas.json` + um arquivo de config por
  persona; a persona padrão "odessa" aponta para o config legado.
- **Geração de vídeo plugável:** provedor selecionado por `VIDEO_GEN_PROVIDER`
  (`placeholder` testa o pipeline sem API real; `routellm` usa a Abacus.AI).
- **Frame capturado no frontend:** o frame base é desenhado do `<video>` ativo
  num canvas (sem ffmpeg no backend), garantindo pixel-exact e compatibilidade
  Windows.
- **Processamento assíncrono:** a fila de vídeos evolui `queued → generating →
  done/error` em thread de fundo, sem bloquear a API.
- **Isolamento por persona:** cada persona tem seu diretório em
  `server/runtime/video-gen/{persona_id}/` (prompts, frames, vídeos, fila,
  histórico).
