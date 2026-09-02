# Geração de Vídeo em Tempo Real

Pipeline que transforma as interações do chat da live em **vídeos gerados em
tempo real**, usando o último frame do vídeo em reprodução como imagem base.

O sistema acumula as mensagens e gatilhos do chat num buffer por persona; ao
atingir um limiar, gera um prompt de cena via IA (RouteLLM/Abacus.AI) e produz
um vídeo a partir do último frame da live. O vídeo gerado é salvo, enfileirado
e registrado no fluxo da persona ativa, ficando disponível no painel e no
editor de fluxo.

---

## 1. Visão geral do fluxo

```
chat (mensagens + gatilhos)
        │  (automation_service.ingest_event → video_gen_service.ingest_event)
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

### Etapas em detalhe

1. **Ingestão** — cada mensagem/gatilho do chat passa por
   `automation_service` e alimenta o buffer de interações da persona ativa
   (`prompt_service.add_interaction`). Só entram no buffer eventos dos tipos
   `chat`, `gift`, `alert` e `comment`.
2. **Geração automática de prompt** — quando o buffer atinge
   `VIDEO_GEN_PROMPT_THRESHOLD` (padrão 5) e `VIDEO_GEN_AUTO=true`, o sistema
   gera um prompt de cena via LLM e enfileira a geração. Um cooldown
   (`VIDEO_GEN_COOLDOWN_MS`, padrão 30 s) evita rajadas.
3. **Geração do vídeo** — o provedor recebe o prompt + o último frame base e
   produz um arquivo de vídeo. O processamento roda em thread de fundo, sem
   bloquear a API.
4. **Registro no fluxo** — o vídeo é adicionado a `config["videos"]` com
   `group="generated"`, ganha um `flowNode` e uma `flowConnection` a partir do
   nó idle, e passa a aparecer no editor de fluxo com o selo **Gerado**.

---

## 2. Configuração

### 2.1 Variáveis de ambiente (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `VIDEO_GEN_PROVIDER` | `placeholder` | Provedor: `placeholder` (teste) ou `routellm` (Abacus.AI) |
| `VIDEO_GEN_API_KEY` | — | Chave da API de vídeo (formato `org:key` da Abacus.AI) |
| `VIDEO_GEN_MODEL` | `video-gen` | Modelo de geração de vídeo |
| `VIDEO_GEN_AUTO` | `true` | Gera automaticamente ao atingir o limiar |
| `ODESSA_VIDEO_GEN_DIR` | `server/runtime/video-gen` | Raiz de persistência por persona |
| `VIDEO_GEN_MAX_QUEUE` | `8` | Tamanho máximo da fila por persona |
| `VIDEO_GEN_FRAME_FORMAT` | `png` | Formato do frame base (`png` ou `jpg`) |
| `VIDEO_GEN_DURATION_SEC` | `4` | Duração do vídeo gerado (segundos) |
| `VIDEO_GEN_WIDTH` | `720` | Largura do vídeo gerado |
| `VIDEO_GEN_HEIGHT` | `1280` | Altura do vídeo gerado |
| `VIDEO_GEN_PROMPT_THRESHOLD` | `5` | Interações antes da geração automática |
| `VIDEO_GEN_COOLDOWN_MS` | `30000` | Cooldown entre gerações automáticas |

Exemplo de bloco no `.env`:

```dotenv
# ── Geração de vídeo em tempo real ─────────────────────────────────────────
VIDEO_GEN_PROVIDER=placeholder
VIDEO_GEN_API_KEY=
VIDEO_GEN_MODEL=video-gen
VIDEO_GEN_AUTO=true
ODESSA_VIDEO_GEN_DIR=server/runtime/video-gen
VIDEO_GEN_MAX_QUEUE=8
VIDEO_GEN_FRAME_FORMAT=png
VIDEO_GEN_DURATION_SEC=4
VIDEO_GEN_WIDTH=720
VIDEO_GEN_HEIGHT=1280
VIDEO_GEN_PROMPT_THRESHOLD=5
VIDEO_GEN_COOLDOWN_MS=30000
```

### 2.2 Escolhendo o provedor

O provedor é selecionado por `VIDEO_GEN_PROVIDER`:

- **`placeholder`** (padrão) — testa o pipeline completo **sem chamar API
  real**. Se `ffmpeg` estiver disponível, gera um vídeo real com zoom suave
  (zoompan) a partir do frame; caso contrário, grava um arquivo marcador para
  que o fluxo de registro continue testável. Ideal para desenvolvimento.
- **`routellm`** — chama a API de geração de vídeo da **Abacus.AI** via
  RouteLLM (OpenAI-compatível), enviando o frame base como imagem de partida e
  o prompt como instrução. Requer `VIDEO_GEN_API_KEY` no formato `org:key`.

> **Nota:** o provedor `routellm` é *best-effort* — o contrato exato do
> endpoint de vídeo pode variar. Se a API não estiver configurada ou falhar,
> o item da fila vai para `error` e o pipeline continua testável com o
> provedor `placeholder`.

### 2.3 Requisitos

- **Backend**: Python 3.12 + FastAPI (já parte do projeto).
- **ffmpeg** (opcional, recomendado): usado pelo provedor `placeholder` para
  gerar vídeos reais. Se ausente, o placeholder grava um marcador.
- **IA de prompt**: a geração de prompt usa `ai_service` (RouteLLM/Gemini).
  Sem chave configurada, o sistema usa um prompt de fallback baseado nos
  presentes/interações do buffer.

---

## 3. Funcionalidades

### 3.1 Buffer de interações do chat

Mensagens e gatilhos são acumulados por persona (máx. 40 interações em
memória). Cada interação guarda `kind`, `user`, `text`/`giftName` e
`timestamp`. O buffer é a matéria-prima do prompt de cena.

### 3.2 Geração de prompt via IA

O `prompt_service` monta um texto com as interações e pede ao LLM um prompt
curto (máx. 60 palavras, em português) descrevendo emoção, movimento e clima
para a reação/performance. O prompt é persistido em `prompts.jsonl` e o buffer
é limpo.

### 3.3 Fila assíncrona de geração

Cada geração passa por `queued → generating → done/error`. O processamento
roda em thread de fundo (`video-gen-processor`). A fila é limitada por
`VIDEO_GEN_MAX_QUEUE`; se cheia, a geração é recusada.

### 3.4 Registro no fluxo da persona

Ao concluir, o vídeo é registrado no fluxo da persona ativa:
- adicionado a `config["videos"]` com `group="generated"` e `generated: true`;
- ganha um `flowNode` posicionado ao lado do nó idle;
- ganha uma `flowConnection` a partir do nó idle (com `returnToIdle: true`);
- é adicionado a `flowCanvasVideoIds`.

No editor de fluxo, vídeos gerados aparecem com borda violeta e o selo
**Gerado**.

### 3.5 Painel em tempo real (`VideoGenPanel`)

Exibido no `UnifiedLivePanel`, mostra:
- **Buffer de chat** — contagem e histórico de interações;
- **Na fila** — vídeos pendentes/em geração;
- **Prompts** — prompts gerados, com botão **Gerar vídeo** no mais recente;
- **Vídeos gerados** — contagem e links para reprodução;
- **Imagens usadas (frames)** — os frames base capturados;
- **Próximo vídeo a gerar** — destaque do item em processamento.

O painel faz polling do estado a cada 3 s.

### 3.6 Ação `video.generate`

O executor de automação (`server/services/automation/executor.py`) reconhece o
tipo de ação `video.generate`, que dispara a geração automática a partir do
buffer de prompts. Isso permite que um gatilho do fluxo (palavra-chave,
presente) também solicite a geração de um vídeo.

---

## 4. Endpoints da API

Todos os endpoints ficam sob `/api/video-gen/*` (prefixo `/api/v1/video-gen/*`
no backend FastAPI).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/video-gen/frame` | Recebe o frame base (data URL) e persiste por persona |
| GET | `/api/video-gen/frame` | Retorna o último frame base (imagem) |
| POST | `/api/video-gen/prompt` | Gera um prompt a partir do buffer de chat |
| GET | `/api/video-gen/prompts` | Lista os prompts gerados |
| POST | `/api/video-gen/generate` | Enfileira a geração de um vídeo |
| GET | `/api/video-gen/queue` | Fila de vídeos pendentes/em geração |
| GET | `/api/video-gen/history` | Histórico de gerações |
| GET | `/api/video-gen/video/{id}` | Serve um vídeo gerado |
| GET | `/api/video-gen/state` | Estado completo para o painel em tempo real |

Todos os endpoints aceitam o parâmetro opcional `personaId` (query ou body)
para operar sobre uma persona específica; sem ele, usam a persona ativa.

---

## 5. Exemplos de uso

### 5.1 Enviar um frame base

O frame é normalmente capturado automaticamente pelo frontend
(`frameCapture.ts`), mas pode ser enviado manualmente:

```bash
curl -X POST http://localhost:8000/api/v1/video-gen/frame \
  -H "Content-Type: application/json" \
  -d '{"dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."}'
```

Resposta:

```json
{ "ok": true, "path": "server/runtime/video-gen/odessa/frames/latest.png" }
```

### 5.2 Gerar um prompt a partir do buffer

```bash
curl -X POST http://localhost:8000/api/v1/video-gen/prompt \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

Resposta:

```json
{
  "ok": true,
  "prompt": {
    "id": "3f2a9c1e-...",
    "personaId": "odessa",
    "prompt": "Reação animada e agradecida ao presente: Coroa Real. Sorriso, energia alta, clima festivo.",
    "source": "fallback",
    "interactions": [
      { "kind": "gift", "user": "lucas", "text": "Coroa Real", "giftName": "Coroa Real" }
    ],
    "createdAt": "2026-09-02T09:00:00+00:00"
  }
}
```

> `force: true` gera o prompt mesmo com o buffer vazio. O campo
> `customInstruction` permite instruções extras para o LLM.

### 5.3 Enfileirar a geração de um vídeo

Por `promptId` (recomendado):

```bash
curl -X POST http://localhost:8000/api/v1/video-gen/generate \
  -H "Content-Type: application/json" \
  -d '{"promptId": "3f2a9c1e-..."}'
```

Ou por texto direto:

```bash
curl -X POST http://localhost:8000/api/v1/video-gen/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Reação surpresa e feliz, olhando para a câmera."}'
```

Resposta:

```json
{
  "ok": true,
  "item": {
    "id": "b7d4e2f0-...",
    "promptId": "3f2a9c1e-...",
    "prompt": "Reação animada e agradecida ao presente: Coroa Real...",
    "status": "queued",
    "framePath": "server/runtime/video-gen/odessa/frames/latest.png",
    "videoId": null,
    "videoPath": null,
    "error": null,
    "createdAt": "2026-09-02T09:00:05+00:00",
    "updatedAt": "2026-09-02T09:00:05+00:00"
  }
}
```

### 5.4 Acompanhar a fila

```bash
curl http://localhost:8000/api/v1/video-gen/queue
```

```json
{
  "queue": [
    {
      "id": "b7d4e2f0-...",
      "status": "done",
      "videoId": "gen-b7d4e2f0",
      "videoPath": "server/runtime/video-gen/odessa/videos/gen-b7d4e2f0.mp4",
      "error": null
    }
  ]
}
```

### 5.5 Consultar o estado completo

```bash
curl http://localhost:8000/api/v1/video-gen/state
```

Retorna `personaId`, `provider`, `auto`, `bufferSize`, `buffer`, `prompts`,
`queue`, `history`, `latestFrame`, `frameHistory`, `videos` e `maxQueue`.

### 5.6 Reproduzir um vídeo gerado

```bash
curl -o video.mp4 http://localhost:8000/api/v1/video-gen/video/gen-b7d4e2f0
```

### 5.7 Histórico de gerações

```bash
curl http://localhost:8000/api/v1/video-gen/history
```

```json
{
  "history": [
    {
      "id": "c1a2b3d4-...",
      "promptId": "3f2a9c1e-...",
      "prompt": "Reação animada...",
      "ok": true,
      "videoId": "gen-b7d4e2f0",
      "videoPath": "server/runtime/video-gen/odessa/videos/gen-b7d4e2f0.mp4",
      "createdAt": "2026-09-02T09:00:10+00:00"
    }
  ]
}
```

---

## 6. Persistência por persona

```
server/runtime/video-gen/{persona_id}/
    prompts.jsonl        # prompts gerados a partir do chat (máx. 200)
    frames/latest.{png|jpg}  # último frame base capturado
    frames/history/      # histórico de frames (máx. 50)
    videos/              # vídeos gerados (.mp4/.webm)
    queue.json           # fila de vídeos pendentes
    history.json         # histórico de gerações (máx. 200)
```

---

## 7. Componentes

### Backend (`server/services/video_gen/`)

| Arquivo | Responsabilidade |
|---|---|
| `base.py` | Interface `VideoGenProvider` + dataclass `VideoGenResult` |
| `registry.py` | Fábrica de provedores por `VIDEO_GEN_PROVIDER` |
| `providers/placeholder.py` | Provedor de teste: gera vídeo via ffmpeg (zoompan) ou marcador |
| `providers/routellm.py` | Provedor real: chama a API de vídeo da Abacus.AI (best-effort) |
| `storage.py` | Persistência por persona (prompts, frames, vídeos, fila, histórico) |
| `prompt_service.py` | Buffer de interações + geração de prompt via RouteLLM |
| `video_gen_service.py` | Orquestrador: prompt + frame → provedor → fila → fluxo |

### Endpoints (`server/api/v1/endpoints/video_gen.py`)

Roteados em `server/api/v1/api.py` sob o prefixo `/video-gen`.

### Frontend

| Arquivo | Responsabilidade |
|---|---|
| `src/core/frameCapture.ts` | Captura do frame ativo via canvas + envio ao backend |
| `src/core/videoGenApi.ts` | Cliente TS para `/api/video-gen/*` |
| `src/components/VideoGenPanel.tsx` | Painel em tempo real (fila, mensagens, prompts, frames) |

### Integrações

- `server/services/automation_service.py` — alimenta o buffer a cada evento.
- `server/services/automation/executor.py` — ação `video.generate`.
- `server/services/workflow_service.py` — `register_generated_video`.
- `src/OdessaLiveCenter.tsx` — registra a captura de frame do player ativo.
- `src/core/chatToTriggerBridge.ts` — envia o frame ao rotear mensagens.
- `src/ReactiveFlowBoard.tsx` — exibe vídeos gerados no fluxo.

---

## 8. Teste rápido

1. Inicie o backend (`npm run dev:api`) e o frontend (`npm run dev`).
2. Com `VIDEO_GEN_PROVIDER=placeholder`, envie um frame e gere um prompt:
   - `POST /api/video-gen/frame` com `{ "dataUrl": "data:image/png;base64,..." }`
   - `POST /api/video-gen/prompt` com `{ "force": true }`
   - `POST /api/video-gen/generate` com `{ "promptId": "<id>" }`
3. Acompanhe em `GET /api/video-gen/state` ou no painel **Geração de Vídeo**
   (seção do `UnifiedLivePanel`).

---

## 9. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| Item da fila em `error: Nenhum frame base disponível` | Nenhum frame foi capturado | Envie um frame via `POST /api/video-gen/frame` ou aguarde a captura automática |
| `error: VIDEO_GEN_API_KEY não configurado` | Provedor `routellm` sem chave | Configure `VIDEO_GEN_API_KEY` (formato `org:key`) ou use `placeholder` |
| `error: Fila cheia (máx 8)` | Fila atingiu `VIDEO_GEN_MAX_QUEUE` | Aumente `VIDEO_GEN_MAX_QUEUE` ou aguarde o processamento |
| `error: ffmpeg error: ...` | ffmpeg ausente ou falhou | Instale ffmpeg ou use o modo marcador do placeholder |
| Prompt de fallback em vez de IA | LLM sem chave configurada | Configure a chave de IA (RouteLLM/Gemini) em `ai_service` |
| Painel mostra "Backend indisponível" | Backend não está rodando | Inicie `npm run dev:api` |
