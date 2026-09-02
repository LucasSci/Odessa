# Histórico de Sessão da Live

Registro central de **tudo o que acontece durante a live**: mensagens
recebidas, presentes, gatilhos disparados, vídeos gerados e respostas de IA.
O histórico é persistido em disco, consultável em tempo real e **exportável em
JSON ou CSV** para análise posterior.

---

## 1. O que é registrado

| Tipo de evento | Descrição | Quando |
|---|---|---|
| `session.started` | Início da sessão | Ao primeiro evento registrado |
| `session.ended` | Fim da sessão | Ao chamar `POST /session-history/end` |
| `chat.received` | Mensagem recebida no chat | No processamento de eventos (`automation_service`) |
| `gift.received` | Presente recebido | No processamento de eventos (inclui agregados) |
| `trigger.fired` | Gatilho casou com um evento | Quando ações são enfileiradas |
| `video.generated` | Vídeo gerado pelo pipeline | Ao concluir/falhar uma geração |
| `ai.reply` | Resposta de IA gerada | No painel de chat (assistido ou autônomo) |
| `ai.reply.sent` | Resposta de IA enviada | Quando a resposta autônoma é enviada |
| `message.sent` | Mensagem enviada manualmente | Ao aprovar rascunho ou enviar manual |

> O registro é **defensivo**: falhas no histórico nunca interrompem o fluxo da
> live (chat, vídeo, automação).

---

## 2. Persistência

Os eventos são gravados em arquivos **JSONL** rotacionados por sessão em:

```
server/runtime/session-history/
    sessions.json                 # índice de sessões (id, início, fim, contagem)
    session_YYYYMMDD_HHMMSS.jsonl # eventos de cada sessão
```

Cada linha do JSONL é um evento:

```json
{
  "id": "evt-098a570028c5",
  "sessionId": "session_20260902_094423",
  "type": "gift.received",
  "timestamp": "2026-09-02T12:44:34.567958+00:00",
  "data": {
    "sender": "lucas",
    "receiver": "Odessa",
    "giftName": "Coroa",
    "quantity": 1,
    "aggregated": false
  }
}
```

---

## 3. Endpoints da API

Todos sob `/api/v1/session-history` (e `/api/session-history`).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/session-history` | Lista eventos (sessão ativa por padrão) |
| GET | `/session-history/sessions` | Lista as sessões registradas |
| GET | `/session-history/export?format=json\|csv` | Exporta o histórico (download) |
| POST | `/session-history/events` | Registra um evento manualmente |
| POST | `/session-history/start` | Inicia/reinicia a sessão |
| POST | `/session-history/end` | Encerra a sessão ativa |

### Parâmetros de listagem

- `sessionId` — filtra por sessão específica.
- `type` — filtra por tipo de evento (ex.: `gift.received`).
- `limit` / `offset` — paginação (padrão `limit=500`).

---

## 4. Exemplos de uso

### 4.1 Listar eventos da sessão ativa

```bash
curl http://localhost:8000/api/v1/session-history
```

```json
{
  "session": {
    "sessionId": "session_20260902_094423",
    "totalEvents": 4,
    "byType": { "gift.received": 1, "chat.received": 1, "ai.reply": 1, "session.started": 1 }
  },
  "events": [
    { "id": "evt-...", "type": "gift.received", "timestamp": "...", "data": { "sender": "lucas", "giftName": "Coroa" } }
  ]
}
```

### 4.2 Filtrar por tipo

```bash
curl "http://localhost:8000/api/v1/session-history?type=gift.received"
```

### 4.3 Exportar em JSON

```bash
curl -o historico.json "http://localhost:8000/api/v1/session-history/export?format=json"
```

### 4.4 Exportar em CSV

```bash
curl -o historico.csv "http://localhost:8000/api/v1/session-history/export?format=csv"
```

O CSV inclui colunas comuns (`id`, `sessionId`, `type`, `timestamp`, `user`,
`text`, `giftName`, `quantity`, `videoId`, `prompt`, `reply`, `status`,
`error`) e uma coluna `data_json` com o payload completo.

### 4.5 Registrar um evento manualmente

```bash
curl -X POST http://localhost:8000/api/v1/session-history/events \
  -H "Content-Type: application/json" \
  -d '{"type":"ai.reply","data":{"username":"lucas","sourceText":"oi","reply":"Oi amor!","provider":"openai"}}'
```

### 4.6 Encerrar a sessão

```bash
curl -X POST http://localhost:8000/api/v1/session-history/end
```

---

## 5. Painel no frontend

O painel **Histórico da Live** fica na aba **Histórico da Live** do
`TangoChatPanel` (ícone de relógio). Ele mostra:

- **Resumo** — contagem de eventos por tipo (mensagens, presentes, gatilhos,
  vídeos, respostas).
- **Filtros** — por sessão e por tipo de evento.
- **Lista de eventos** — cada evento com horário, tipo e resumo legível.
- **Exportar JSON / Exportar CSV** — baixa o histórico da sessão selecionada.

O painel faz polling a cada 3 s e atualiza em tempo real durante a live.

---

## 6. Componentes

### Backend

| Arquivo | Responsabilidade |
|---|---|
| `server/services/session_history.py` | Serviço de histórico (registro, leitura, exportação) |
| `server/api/v1/endpoints/session_history.py` | Endpoints REST |

### Integrações

- `server/services/automation_service.py` — registra `chat.received`,
  `gift.received` e `trigger.fired`.
- `server/services/video_gen/video_gen_service.py` — registra
  `video.generated`.
- `src/components/TangoChatPanel.tsx` — registra `ai.reply`, `ai.reply.sent`
  e `message.sent`; exibe o painel.

### Frontend

| Arquivo | Responsabilidade |
|---|---|
| `src/core/sessionHistory.ts` | Cliente TS para `/session-history/*` |
| `src/components/SessionHistoryPanel.tsx` | Painel de histórico com exportação |
