# Geração de Vídeo em Tempo Real

Pipeline que transforma as interações do chat da live em **vídeos gerados em
tempo real**, usando o último frame do vídeo em reprodução como imagem base.

## Visão geral do fluxo

```
chat (mensagens + gatilhos)
        │  (automation_service.ingest_event)
        ▼
buffer de interações por persona  (prompt_service)
        │  (atinge VIDEO_GEN_PROMPT_THRESHOLD → geração automática)
        ▼
prompt de vídeo via RouteLLM  (prompt_service.generate_prompt)
        │  (persistido em prompts.jsonl)
        ▼
enfileira geração  (video_gen_service.enqueue)
        │
        ▼
processamento assíncrono  (queued → generating → done/error)
        │  (provedor: prompt + último frame → vídeo)
        ▼
vídeo salvo por persona  (storage.save_generated_video)
        │
        ▼
registrado no fluxo  (workflow_service.register_generated_video)
        │  (config["videos"] group="generated" + flowNode + flowConnection)
        ▼
visível no painel  (VideoGenPanel) e no ReactiveFlowBoard
```

## Componentes

### Backend (`server/services/video_gen/`)

| Arquivo | Responsabilidade |
|---|---|
| `base.py` | Interface `VideoGenProvider` + dataclass `VideoGenResult` |
| `registry.py` | Fábrica de provedores por `VIDEO_GEN_PROVIDER` |
| `providers/placeholder.py` | Provedor de teste: gera vídeo real via ffmpeg (zoompan) a partir do frame |
| `providers/routellm.py` | Provedor real: chama a API de vídeo da Abacus.AI (best-effort) |
| `storage.py` | Persistência por persona (prompts, frames, vídeos, fila, histórico) |
| `prompt_service.py` | Buffer de interações + geração de prompt via RouteLLM |
| `video_gen_service.py` | Orquestrador: prompt + frame → provedor → fila → fluxo |

### Endpoints (`server/api/v1/endpoints/video_gen.py`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/video-gen/frame` | Recebe o frame base (data URL) e persiste |
| GET | `/api/video-gen/frame` | Retorna o último frame base |
| POST | `/api/video-gen/prompt` | Gera um prompt a partir do buffer de chat |
| GET | `/api/video-gen/prompts` | Lista os prompts gerados |
| POST | `/api/video-gen/generate` | Enfileira a geração de um vídeo |
| GET | `/api/video-gen/queue` | Fila de vídeos pendentes/em geração |
| GET | `/api/video-gen/history` | Histórico de gerações |
| GET | `/api/video-gen/video/{id}` | Serve um vídeo gerado |
| GET | `/api/video-gen/state` | Estado completo para o painel em tempo real |

### Frontend

| Arquivo | Responsabilidade |
|---|---|
| `src/core/frameCapture.ts` | Captura do frame ativo via canvas + envio ao backend |
| `src/core/videoGenApi.ts` | Cliente TS para `/api/video-gen/*` |
| `src/components/VideoGenPanel.tsx` | Painel em tempo real (fila, mensagens, prompts, frames) |

## Persistência por persona

```
server/runtime/video-gen/{persona_id}/
    prompts.jsonl        # prompts gerados a partir do chat
    frames/latest.{png|jpg}  # último frame base capturado
    frames/history/      # histórico de frames
    videos/              # vídeos gerados
    queue.json           # fila de vídeos pendentes
    history.json         # histórico de gerações
```

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `VIDEO_GEN_PROVIDER` | `placeholder` | `placeholder` (teste) ou `routellm` (Abacus.AI) |
| `VIDEO_GEN_API_KEY` | — | Chave da API de vídeo (formato `org:key`) |
| `VIDEO_GEN_MODEL` | `video-gen` | Modelo de geração de vídeo |
| `VIDEO_GEN_AUTO` | `true` | Gera automaticamente ao atingir o limiar |
| `ODESSA_VIDEO_GEN_DIR` | `server/runtime/video-gen` | Raiz de persistência |
| `VIDEO_GEN_MAX_QUEUE` | `8` | Tamanho máximo da fila por persona |
| `VIDEO_GEN_FRAME_FORMAT` | `png` | Formato do frame base |
| `VIDEO_GEN_DURATION_SEC` | `4` | Duração do vídeo gerado (s) |
| `VIDEO_GEN_WIDTH` / `HEIGHT` | `720` / `1280` | Resolução do vídeo |
| `VIDEO_GEN_PROMPT_THRESHOLD` | `5` | Interações antes da geração automática |
| `VIDEO_GEN_COOLDOWN_MS` | `30000` | Cooldown entre gerações automáticas |

## Ação `video.generate`

O executor de automação (`server/services/automation/executor.py`) reconhece o
tipo de ação `video.generate`, que dispara a geração automática a partir do
buffer de prompts. Isso permite que um gatilho do fluxo (palavra-chave,
presente) também solicite a geração de um vídeo.

## Teste rápido

1. Inicie o backend (`npm run dev:api`) e o frontend (`npm run dev`).
2. Com `VIDEO_GEN_PROVIDER=placeholder`, envie um frame e gere um prompt:
   - `POST /api/video-gen/frame` com `{ "dataUrl": "data:image/png;base64,..." }`
   - `POST /api/video-gen/prompt` com `{ "force": true }`
   - `POST /api/video-gen/generate` com `{ "promptId": "<id>" }`
3. Acompanhe em `GET /api/video-gen/state` ou no painel **Geração de Vídeo**.
