# Changelog

Todas as mudanças relevantes do projeto Odessa.

## [1.1.0] — Em desenvolvimento

### Adicionado
- **Central da Live com prontidão**: veredito em uma frase sobre o envio
  real, estado de IA/captura/envio/OBS/vídeo, última resposta enviada e
  bloqueada, confirmação antes do envio real. (#168)
- **Memória do chat pela bridge**: novo/recorrente/presenteador nas
  respostas, "memórias usadas" e reset do aprendizado. (#165)
- **Espectadores na memória**: buscar, ocultar das respostas ou esquecer um
  espectador específico, na Central da Live → Insights. (#252)
- **Envio confirmado no chat**: a bridge só chama de "Enviada" a mensagem que
  apareceu no chat do Tango; "sem confirmação" e "falhou" (com a etapa) ficam
  visíveis na fila, na Prontidão e no teste do Passo 4. Envios simultâneos não
  se misturam e o eco da própria Odessa não vira fala de espectador. (#158)
- **Governador da bridge**: duplicadas, moderação e prioridade de presentes;
  status "simulada" e "falhou" na fila. (#156, #158–#160)
- **Padrões de engenharia e esteira de qualidade** — fluxo Issue → Pull
  Request para qualquer agente, CI com ESLint, arch-contract, Knip,
  Commitlint, cobertura no Codecov, orçamento de performance, auditoria de
  dependências, E2E com Playwright, CodeQL e testes de mutação (Stryker).
  (`docs/ENGINEERING-STANDARDS.md`, #239–#242)
- **Observabilidade opt-in com Sentry** no frontend e no backend, sem dados
  pessoais, e ErrorBoundary por página. (#243)
- **Rate limit** por IP na borda da API e no login. (#247)
- **Sistema de motion** (skill Design Motion Principles): skeletons, entrada e
  saída animadas em modais/menus/avisos, estados de progresso e tokens únicos;
  remove ripple/bounce/loops decorativos. (#244, #245)
- **Instalador desktop (Windows)** — `OdessaStudioSetup.exe` autocontido:
  empacota o backend Python, o frontend buildado e um runtime Python completo
  (interpretador + dependências + Chromium do Playwright). Quem instala não
  precisa de Python, Node ou dependências de dev. Interface do instalador em
  Modern UI 2 do NSIS, assinado com certificado próprio do projeto. É a forma
  atual de distribuir a Odessa (a Hostinger não está mais em uso).
  (`desktop/`, ver `desktop/README.md`)
- **Detecção explícita de idioma nas respostas do chat** — heurística leve
  (sem dependências) para português/inglês/espanhol; quando detecta com
  confiança, instrui a IA a responder OBRIGATORIAMENTE naquele idioma, em vez
  de depender só do modelo local se autocorrigir.
  (`src/core/tangoAiChatService.ts`)
- **Laboratório local de conversa por persona** — nova aba no
  `OdessaLiveCenter` para testar personalidades e respostas da IA sem iniciar
  live, OBS, bridge ou OCR. Cada persona mantém seu próprio histórico de teste;
  o provedor local padrão é Ollama, com modelo e URL configuráveis no painel de
  IA. (`src/components/PersonaChatLab.tsx`, `src/core/aiConfig.ts`,
  `src/core/tangoAiChatService.ts`)
- **Status e roteamento de provedores de IA** — endpoint
  `/api/v1/ai/status` e suporte explícito a Ollama, Gemini e OpenAI/RouteLLM
  no endpoint conversacional, com fallback local configurável.
  (`server/api/v1/endpoints/ai.py`, `server/services/ai_service.py`)
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
- Em desenvolvimento, o stream de mensagens do chat (SSE) ia direto na porta
  da bridge e levava 401: nenhuma mensagem chegava ao app. Agora passa pelo
  proxy do backend, como no build. (#158)
- Chave Gemini inválida (`MY_GEMINI_API_KEY` placeholder) — o chat caía em
  respostas prontas locais. Agora usa a RouteLLM configurada.
- Bridge do Tango apontando para site de teste (`pt.anotepad.com`) — corrigido
  para o Tango com seletores corretos.
- Eco da própria fala e repetição de palavras nas respostas — o observer da
  bridge não distinguia mensagem de espectador de mensagem que a própria
  persona acabou de enviar; adicionada janela de supressão de auto-eco.
  (`src/core/tangoChatSession.tsx`, `server/services/ai_service.py`)
- **Chromium do instalador desktop não era encontrado em tempo de execução**
  — faltava repassar `PLAYWRIGHT_BROWSERS_PATH=0` ao subir o backend
  instalado; a bridge falhava ao abrir o navegador mesmo com o Chromium
  corretamente empacotado. (`desktop/launcher/start-odessa.ps1`)
- **Instalador assinado falhava com "Installer integrity check has failed"**
  — assinar o `.exe` depois de compilado mudava seu tamanho e quebrava a
  checagem de CRC interna do NSIS; desligada via `CRCCheck off` (a própria
  assinatura Authenticode já garante a integridade). (`desktop/odessa.nsi`)
- **Acoplamento via CDP ao Chrome real às vezes não encontrava a aba do
  Tango** — a busca rodava uma única vez logo após conectar, sem esperar a
  página terminar de carregar; e duas tentativas de conexão concorrentes
  (autoconnect + acoplamento manual) podiam se sobrescrever silenciosamente.
  (`tango_chat/tango_chat.py`)
- **Causa raiz de "a bridge conecta mas o chat não aparece" no app
  empacotado**: o caminho `/tango-bridge` (usado pelo frontend pra falar com
  a bridge — conectar, enviar mensagem, e principalmente o stream de
  mensagens em tempo real) só tinha proxy no servidor de desenvolvimento do
  Vite; nunca existiu no build de produção. Adicionado proxy reverso real
  (HTTP + WebSocket) em `server/main.py`.
- IA sempre respondia em português, ignorando o idioma da mensagem do chat
  — ver "Detecção explícita de idioma" em Adicionado, acima.
- Removidos segredos padrão fixos no código (`ODESSA_SESSION_SECRET`,
  `ODESSA_AGENT_TOKEN`) tanto no backend Python quanto no legado Node/Hostinger
  — agora o backend recusa iniciar se não forem configurados via variável de
  ambiente. (`server/core/auth.py`, `api/[...path].js`, `api/ai/decide.js`)

## [1.0.0] — Versão inicial

- Sistema de persona virtual para lives (TikTok/Tango Live).
- Player de vídeo reativo a presentes, comentários e agendamentos.
- Editor visual de fluxo (ReactiveFlow).
- Overlay para OBS (Browser Source).
- Backend Python FastAPI + backend Node.js para produção (Hostinger).
- Bridge do Tango (captura de chat e tela via Playwright/CDP).
