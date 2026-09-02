# Referência da API

O backend Python FastAPI expõe a API em `/api/v1/*` (e também em `/api/*` para
compatibilidade com o modo cloud). A autenticação usa um token de sessão no
header `Authorization: Bearer <token>`, obtido no login.

## Autenticação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login (retorna `sessionToken`) |
| POST | `/api/auth/logout` | Encerra a sessão |
| GET | `/api/auth/me` | Dados do usuário autenticado |
| POST | `/api/auth/change-password` | Altera a senha |

## Health

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` ou `/api/health` | Status do backend, versão, provedores de IA configurados |

## Vídeo

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/video/available` | Lista vídeos disponíveis |
| GET | `/api/v1/video/state` | Estado atual do player |
| GET | `/api/v1/video/next` | Próximo vídeo da fila |
| GET | `/api/v1/video/play/{video_id}` | Reproduz um vídeo |
| POST | `/api/v1/video/force` | Força a reprodução de um vídeo |
| POST | `/api/v1/video/idle` | Volta ao vídeo idle |
| POST | `/api/v1/video/advance` | Avança na fila |
| POST | `/api/v1/video/upload` | Upload de vídeo |
| GET | `/api/v1/video/config` | Config de vídeo |
| POST | `/api/v1/video/config` | Atualiza config de vídeo |
| GET | `/api/v1/video/workflow/export` | Exporta o workflow |
| POST | `/api/v1/video/workflow/import` | Importa o workflow |
| POST | `/api/v1/video/workflow/validate` | Valida o workflow |
| POST | `/api/v1/video/preview-action` | Pré-visualiza uma ação |
| POST | `/api/v1/video/{video_id}/archive` | Arquiva um vídeo |
| DELETE | `/api/v1/video/{video_id}` | Exclui um vídeo |

## Workflow

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/workflow/published` | Workflow publicado |
| GET | `/api/v1/workflow/draft` | Rascunho do workflow |
| POST | `/api/v1/workflow/draft` | Salva o rascunho |
| POST | `/api/v1/workflow/draft/validate` | Valida o rascunho |
| POST | `/api/v1/workflow/draft/test` | Testa o rascunho |
| POST | `/api/v1/workflow/publish` | Publica o workflow |

## Automação (gatilhos)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/automation/ingest` | **Ingere um evento** (comentário/presente) e dispara gatilhos |
| POST | `/api/v1/automation/dry-run` | Simula um evento sem executar |
| POST | `/api/v1/automation/test-trigger` | Testa um gatilho |
| GET | `/api/v1/automation/queue` | Fila de eventos |
| GET | `/api/v1/automation/logs` | Logs da automação |
| GET | `/api/v1/automation/metrics` | Métricas |
| GET | `/api/v1/automation/next-action` | Próxima ação |

Exemplo de ingest:

```bash
curl -X POST http://localhost:8000/api/v1/automation/ingest \
  -H "Content-Type: application/json" \
  -d '{"text":"Lucas enviou uma Rosa x2","source":"chat_api","kind":"chat","metadata":{"username":"Lucas"},"execute":true}'
```

## IA generativa

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/ai/respond` | Gera uma resposta conversacional (RouteLLM/OpenAI/Gemini) |
| POST | `/api/v1/ai/decide` | Decisão da Diretora (fala + vídeo + cena) |
| POST | `/api/v1/ai/gemini` | Chamada direta ao Gemini |

Exemplo de respond:

```bash
curl -X POST http://localhost:8000/api/v1/ai/respond \
  -H "Content-Type: application/json" \
  -d '{"persona_prompt":"Você é a Odessa...","chat_context":"Usuário: Lucas","user_prompt":"Mensagem: \"oi amores\"","temperature":0.7}'
```

## Personas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/personas` | Lista personas e a ativa |
| GET | `/api/v1/personas/active` | Persona ativa + config |
| POST | `/api/v1/personas/active` | Define a persona ativa (`{"id":"..."}`) |
| POST | `/api/v1/personas` | Cria uma persona |
| PATCH | `/api/v1/personas/{id}` | Atualiza metadados (nome/descrição/personalidade) |
| DELETE | `/api/v1/personas/{id}` | Exclui uma persona |
| GET | `/api/v1/personas/active/personality` | Personalidade da persona ativa |
| PUT | `/api/v1/personas/{id}/personality` | Define a personalidade |
| GET | `/api/v1/personas/{id}/config` | Config de uma persona específica |

## Chat automático / Bridge do Tango

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/chat-automation/config` | Config do chat automático |
| POST | `/api/v1/chat-automation/config` | Atualiza a config |
| POST | `/api/v1/chat-automation/send` | Envia uma mensagem no chat |
| GET | `/api/v1/chat-automation/bridge/status` | Status da bridge |
| POST | `/api/v1/chat-automation/bridge/start` | Inicia a bridge |
| POST | `/api/v1/chat-automation/bridge/stop` | Para a bridge |
| GET | `/api/v1/chat-automation/bridge/config` | Config da bridge |
| POST | `/api/v1/chat-automation/bridge/config` | Atualiza a config da bridge |
| GET | `/api/v1/chat-automation/bridge/logs` | Logs da bridge |

## OCR

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/ocr/process` | Processa uma imagem (OCR) |
| POST | `/api/v1/ocr/ingest` | Rota central de OCR para automação |
| GET | `/api/v1/ocr/zones` | Zonas de captura |
| GET | `/api/v1/ocr/config` | Config do OCR |
| POST | `/api/v1/ocr/config` | Atualiza a config |

## OBS

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/obs/health` | Status da conexão OBS |
| GET | `/api/v1/obs/scenes` | Lista de cenas |
| GET | `/api/v1/obs/sources` | Lista de fontes |
| POST | `/api/v1/obs/switch-scene` | Troca de cena |
| POST | `/api/v1/obs/start-live` | Inicia a transmissão |
| POST | `/api/v1/obs/transmission/start` | Inicia a transmissão |
| POST | `/api/v1/obs/transmission/stop` | Para a transmissão |
| POST | `/api/v1/obs/setup-live-scene` | Prepara a cena da live |
| POST | `/api/v1/obs/screenshot` | Captura de tela |

## TTS

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/tts` | Gera áudio (texto → fala) |
| GET | `/api/v1/tts/voices` | Lista de vozes |

## Memória

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/memory/stats` | Estatísticas de memória |
| GET | `/api/v1/memory/profiles` | Perfis de usuários |
| GET | `/api/v1/memory/profiles/{user_id}` | Perfil de um usuário |
| POST | `/api/v1/memory/profiles/{user_id}/visibility` | Visibilidade do perfil |
| DELETE | `/api/v1/memory/profiles/{user_id}` | Exclui um perfil |

## Conversas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/conversations` | Lista conversas |
| POST | `/api/v1/conversations` | Cria uma conversa |
| GET | `/api/v1/conversations/{id}` | Detalhes de uma conversa |
| POST | `/api/v1/conversations/{id}/messages` | Adiciona mensagem |
| POST | `/api/v1/conversations/{id}/reply` | Gera resposta |
| POST | `/api/v1/conversations/{id}/approve` | Aprova resposta |

## Webhooks

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/webhooks` | Lista webhooks |
| POST | `/api/v1/webhooks` | Cria um webhook |
| POST | `/api/v1/webhooks/dispatch` | Dispara um webhook |
| DELETE | `/api/v1/webhooks/{id}` | Exclui um webhook |
| POST | `/api/v1/webhooks/{id}/test` | Testa um webhook |

## Proxy

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/proxy` | Proxy de página para iframe (remove X-Frame-Options/CSP) |
| GET | `/api/v1/proxy/asset` | Proxy de asset estático |

## Geração de vídeo em tempo real

Pipeline que transforma interações do chat em vídeos gerados a partir do último
frame da live. Detalhes em [`VIDEO-GEN.md`](VIDEO-GEN.md).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/video-gen/frame` | Recebe o frame base (data URL) e persiste por persona |
| GET | `/api/v1/video-gen/frame` | Retorna o último frame base |
| POST | `/api/v1/video-gen/prompt` | Gera um prompt a partir do buffer de chat |
| GET | `/api/v1/video-gen/prompts` | Lista os prompts gerados |
| POST | `/api/v1/video-gen/generate` | Enfileira a geração de um vídeo |
| GET | `/api/v1/video-gen/queue` | Fila de vídeos pendentes/em geração |
| GET | `/api/v1/video-gen/history` | Histórico de gerações |
| GET | `/api/v1/video-gen/video/{id}` | Serve um vídeo gerado |
| GET | `/api/v1/video-gen/state` | Estado completo para o painel em tempo real |

## Bridge do Tango (porta 7555)

A bridge expõe um servidor aiohttp próprio:

| Método | Rota | Descrição |
|---|---|---|
| GET | `/messages` | SSE — stream de mensagens do chat |
| GET | `/history?limit=N` | Histórico de mensagens |
| GET | `/screenshot` | Captura de tela (JPEG) |
| GET | `/viewport` | Viewport e URL atual |
| POST | `/send` | Envia mensagem no chat |
| POST | `/connect` | Conecta ao Tango |
| POST | `/disconnect` | Desconecta |
