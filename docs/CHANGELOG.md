# Changelog

Todas as mudanças relevantes do projeto Odessa.

## [1.1.0] — Em desenvolvimento

### Adicionado
- **Geração de vídeo em tempo real** — as interações do chat (mensagens +
  gatilhos) alimentam um buffer de prompts; ao atingir o limiar, um prompt é
  gerado via RouteLLM e um vídeo é criado a partir do último frame da live. O
  vídeo é salvo por persona, enfileirado (queued → generating → done/error) e
  registrado no fluxo da persona ativa. Provedor plugável via
  `VIDEO_GEN_PROVIDER` (`placeholder` testa o pipeline sem API real; `routellm`
  usa a Abacus.AI). Painel em tempo real (`VideoGenPanel`) mostra fila,
  histórico de mensagens, prompts, próximo vídeo e frames usados.
  (`server/services/video_gen/`, `server/api/v1/endpoints/video_gen.py`,
  `src/core/frameCapture.ts`, `src/core/videoGenApi.ts`,
  `src/components/VideoGenPanel.tsx`)
- **Histórico de sessão da live** — registro central de tudo o que acontece
  durante a live (mensagens recebidas, presentes, gatilhos disparados, vídeos
  gerados, respostas de IA) persistido em JSONL por sessão e **exportável em
  JSON ou CSV**. Painel **Histórico da Live** no `TangoChatPanel` com resumo
  por tipo, filtros e botões de exportação. (`server/services/session_history.py`,
  `server/api/v1/endpoints/session_history.py`, `src/core/sessionHistory.ts`,
  `src/components/SessionHistoryPanel.tsx`)
- **Perfis de IA (personas)** — múltiplas personas selecionáveis, cada uma com
  vídeos, fluxo, gatilhos e personalidade próprios. Personas padrão: Odessa,
  Viktoria, Barbara. (`server/core/persona_manager.py`, `server/api/v1/endpoints/personas.py`,
  `src/components/PersonaSelector.tsx`, `src/core/personaManager.ts`)
- **IA generativa via RouteLLM** — o chat responde com IA real (RouteLLM da
  Abacus.AI, compatível com OpenAI), com fallback para Gemini e respostas
  prontas locais. (`server/config.py`, `server/services/ai_service.py`,
  `src/core/tangoAiChatService.ts`)
- **Conversa automática com governança anti-flood** — cooldown global, limite
  por minuto, cooldown por usuário e anti-flood de repetição.
  (`src/core/chatConversationGovernor.ts`)
- **Chat → gatilhos do fluxo** — as mensagens do chat da bridge são roteadas
  para o trigger engine do backend, disparando troca de vídeo por palavra-chave
  ou presente. (`src/core/chatToTriggerBridge.ts`)
- **Auto-início da bridge do Tango** no startup do backend
  (`ODESSA_AUTOSTART_BRIDGE`). (`server/main.py`)
- **Documentação completa** em `docs/` (arquitetura, setup, deploy, API, OBS,
  personas, testes).

### Corrigido
- Chave Gemini inválida (`MY_GEMINI_API_KEY` placeholder) — o chat caía em
  respostas prontas locais. Agora usa a RouteLLM configurada.
- Bridge do Tango apontando para site de teste (`pt.anotepad.com`) — corrigido
  para o Tango com seletores corretos.

## [1.0.0] — Versão inicial

- Sistema de persona virtual para lives (TikTok/Tango Live).
- Player de vídeo reativo a presentes, comentários e agendamentos.
- Editor visual de fluxo (ReactiveFlow).
- Overlay para OBS (Browser Source).
- Backend Python FastAPI + backend Node.js para produção (Hostinger).
- Bridge do Tango (captura de chat e tela via Playwright/CDP).
