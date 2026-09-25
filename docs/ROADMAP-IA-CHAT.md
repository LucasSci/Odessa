# Roadmap IA conversa com o chat (#169) — rastreabilidade

Cada critério de aceite das issues #156–#168, onde está atendido e o que prova.

**Arquitetura atual.** Em set/2026 o OCR e a calibração visual do chat foram
removidos de propósito (`fab092d`, `bca0fba`, `3fce2d2`). Hoje o chat do Tango
chega e sai pela **bridge** (`tango_chat/tango_chat.py`, Chromium com
MutationObserver): mensagens via SSE para `src/core/tangoChatSession.tsx`,
respostas pelo `POST /send` da bridge. Os critérios escritos para OCR/alvo
visual foram mapeados para esse fluxo (decisão do dono do projeto,
set/2026). O que só existia no OCR aparece como **não se aplica**.

Legenda: ✅ atendido e testado · 🟡 atendido, validação manual pendente · ➖ não se aplica.

## #156 — Eventos do chat limpos e únicos

| Critério | Status | Evidência |
|---|---|---|
| Mensagem simples chega como evento limpo e único | ✅ | Bridge deduplica `usuário::texto` e ignora placeholders ("A traduzir…") e o eco da própria persona (`tango_chat.py` → `extractMessage`; `isOwnEcho`). Governador bloqueia duplicada (`chatConversationGovernor.test.ts` → "não responde a mesma mensagem duplicada") |
| Presentes continuam priorizados como `gift` | ✅ | `classifyIncomingMessage` → `gift`; presente passa na frente da conversa casual (`chatConversationGovernor.test.ts`); gatilhos de presente → vídeo via `routeChatToTriggers` |
| Duplicadas não geram múltiplas ações | ✅ | Dedupe na bridge + `duplicate_message` no governador + dedupe/cooldown do trigger engine |
| Logs mostram origem e confiança | ✅ | Histórico mostra `origem: bridge`, confiança e tipo (`SessionHistoryPanel.tsx`); `ReactiveFlowLogLab` mostra zona/confiança dos eventos da Diretora |
| Confiança de OCR | ➖ | Texto vem do DOM do chat (exato), não de OCR |

## #157 — "Calibração" do campo de chat (mapeada para a bridge)

| Critério | Status | Evidência |
|---|---|---|
| Configurar sem editar JSON | ✅ | Central da Live → Configuração Automática (detecta seletores, passo a passo com teste de digitação) |
| Painel informa que o alvo está validado | ✅ | Prontidão da Live → "Envio no chat: Campo do chat validado" quando a bridge confirma o campo (`observerInjected`) — `liveReadinessSupervisor.test.ts` |
| Teste sem enviar mostra texto e modo planejado | ✅ | Modo teste: a resposta vai para a fila como **Simulada (teste)** com o texto; nada sai no chat (`ReplyStatus.tsx`, `sendWithOutcome`) |
| Sobrevive ao reload | ✅ | Config da bridge persistida no backend (`/chat-automation/bridge/config`, `tests/test_bridge.py`) |
| Ponto de clique / viewport normalizado | ➖ | Não existe clique por coordenada: a bridge escreve pelo seletor do campo |

## #158 — Envio real na máquina da live, não na nuvem

| Critério | Status | Evidência |
|---|---|---|
| Em cloud o backend enfileira e não mexe no mouse | ✅ | `/chat-automation/send` → `queued: true` (`chatAutomationApi.test.ts`); `/chat-automation/web-send` responde 501 em nuvem (#249) |
| No computador da live a mensagem é digitada e enviada | ✅ / 🟡 | `send_message` da bridge: clica no campo, digita, envia (Enter ou botão) e **confirma que a mensagem apareceu no chat** pelo observer; um envio por vez, nova tentativa só antes de digitar, sobra no campo apagada — `server/tests/test_tango_bridge_send.py`, inclusive em Chromium real com o observer da bridge. Rodado também de ponta a ponta (UI → backend → processo da bridge via CDP → página com o DOM do Tango). **Falta validar uma vez no Tango de verdade** (depende de login na conta): Configuração Automática → Passo 4 → "Testar envio no chat" com Envio Real; o resultado "Enviada e confirmada no chat do Tango" fecha o critério |
| Painel mostra enfileirada/executada/bloqueada/falhou | ✅ | Status Aguardando / Enviando / Enviada / **Enviada · sem confirmação** / Simulada / Bloqueada / **Falhou no envio** (com motivo, etapa e "Tentar de novo"); Prontidão avisa quando a última não apareceu no chat; histórico registra confirmada/sem confirmação e falhas com `commandId` |

## #159 — Fila de respostas públicas

| Critério | Status | Evidência |
|---|---|---|
| Manual/Assistido: nada sai sem aprovação | ✅ | Só o modo Autônomo envia sozinho (`handleAutoTriggerAi` exige `autonomyMode === 'auto'`); Assistido gera rascunho para aprovar/editar/regerar/descartar |
| Assistido: preview enquanto vídeo/voz seguem | ✅ | Fila independente do palco; `chatReplyQueue.test.ts` (Diretora) |
| Autônomo: envia sem toque humano quando o governador libera | ✅ | `handleAutoTriggerAi` → `shouldReplyToMessage` → envio; `chatReplyQueue.test.ts` |
| Operador entende por que respondeu ou bloqueou | ✅ | "Por quê", motivo do bloqueio, memórias usadas no cartão; histórico com `ai.reply.skipped` e motivo legível (`describeReplyBlock`) |

## #160 — Governador de segurança

| Critério | Status | Evidência |
|---|---|---|
| Explica todos os bloqueios nos logs | ✅ | Todo pulo vira `ai.reply.skipped` com motivo — **corrigido**: o backend recusava esse tipo com 400 (`tests/test_session_history_events.py`) |
| Não responde duplicada nem de baixa confiança | ✅ | `duplicate_message` (bridge); baixa confiança na Diretora (`liveAutonomyGovernor.test.ts`, `liveSimulation.test.ts`) |
| Presentes e moderação têm prioridade | ✅ | Moderação nunca recebe resposta pública; presente fura o cooldown casual (`chatConversationGovernor.test.ts`) |
| Modo real só envia com tudo verde | ✅ | Envio autônomo real exige bridge conectada (`bridge_not_ready`); prontidão mostra o que falta |

## #161 — Contrato da Diretora

| Critério | Status | Evidência |
|---|---|---|
| Fala + chat + vídeo numa rodada sem duplicação | ✅ | `aiDecisionContract.test.ts` → "keeps speech, chat reply and video in one round…" |
| Nunca inventa id de vídeo/cena | ✅ | `aiDecisionContract.test.ts` → "drops video and scene ids that are outside the real catalog" |
| Resposta inválida cai em fallback auditável | ✅ | `aiDecisionContract.test.ts` (JSON incompleto/ inválido) + `liveSimulation.test.ts` |

## #162 — Watchdog de saúde

| Critério | Status | Evidência |
|---|---|---|
| Quando algo falha, reduz autonomia ou pausa ações arriscadas | ✅ | `useLiveSupervisor`: com a live no ar pausa o chat autônomo, volta ao idle, reconecta OBS, reduz autonomia (`useLiveSupervisor.test.tsx`, `liveReadinessSupervisor.test.ts`). **Corrigido**: o supervisor olhava para OCR/alvo visual removidos e rebaixava a autonomia sem parar |
| Diagnóstico claro e ação sugerida | ✅ | Prontidão da Live mostra estado, detalhe e "→ ação sugerida" por subsistema (E2E `e2e/central.spec.ts`) |
| Volta ao idle quando o vídeo trava | ✅ | `return_to_idle` (`liveReadinessSupervisor.test.ts`). **Corrigido**: o monitor lia campos que o backend não envia e acusava "vídeo travado" no idle (`useAutopilotRuntime.test.ts` → `parseVideoState`) |

## #163 — Prioridades e anti-interrupção

| Critério | Status | Evidência |
|---|---|---|
| Presentes vencem conversa casual | ✅ | `liveActionPolicy.test.ts` → "orders moderation, gifts and alerts ahead of casual chat"; bridge: `chatConversationGovernor.test.ts` |
| Vídeos não são trocados de forma brusca | ✅ | `liveActionPolicy.test.ts` → "waits for idle before replacing a non-urgent video" |
| Esperar, enfileirar ou descartar com motivo | ✅ | `liveActionPolicy.test.ts` → "discards old and duplicate events…", "blocks chat_reply when an urgent video or OBS action is planned" |

## #164 — Modos de autonomia

| Critério | Status | Evidência |
|---|---|---|
| O usuário entende o que a IA pode fazer sozinha | ✅ | Frase por modo na Prontidão e na confirmação do envio real (`describeChatAutonomy`); matriz da Diretora explicada por ferramenta (`autonomyMatrix.test.ts`) |
| `chat.reply` real não roda só porque está em auto | ✅ | Bridge: exige envio real + bridge conectada; Diretora: `autonomyMatrix.test.ts` → "auto blocks chat.reply real until target and local agent are ready" |
| Troca de modo vale na próxima rodada sem reload | ✅ | Modo lido por `ref` a cada mensagem (`autonomyModeRef`) e salvo em `localStorage`; **corrigido** o supervisor que desfazia o Autônomo sozinho |

## #165 — Memória do chat

| Critério | Status | Evidência |
|---|---|---|
| Reconhece recorrência sem inventar intimidade | ✅ | Perfil novo/recorrente/presenteador no prompt com instrução explícita (`chatMemory.test.ts`); memória por usuário alimentada pela bridge, **corrigida** colisão de chave no backend (`server/tests/test_memory_service.py`) |
| Decisão mostra "memórias usadas" nos logs | ✅ | `memoriesUsed` no cartão da fila e no histórico |
| Operador pode limpar/resetar aprendizado | ✅ | "Resetar aprendizado" (tendências + `DELETE /memory/profiles`) |
| Operador pode ocultar ou esquecer um espectador | ✅ | Insights → "Espectadores na memória" (#252): oculto não entra no prompt, esquecer apaga perfil e interações (`ChatMemoryProfiles.test.tsx`, `server/tests/test_memory_service.py`) |
| Não guardar dado desnecessário/sensível | ✅ | Moderação não é guardada; e-mail/telefone mascarados (`chatMemory.test.ts`) |

## #166 — Logs auditáveis e replay

| Critério | Status | Evidência |
|---|---|---|
| Saber onde um erro aconteceu | ✅ | Timeline por rodada (eventos → decisão → governador → execução) no `ReactiveFlowLogLab`; histórico da sessão com motivos; Sentry opcional |
| Reproduzir uma rodada sem estar ao vivo | ✅ | Botão de replay (`replayRound`) e `npm run simulate:live` |
| Logs não travam a UI em lives longas | ✅ | Listas com teto (400 mensagens, 30 respostas, histórico paginado em 500) |

## #167 — Simulador de live

| Critério | Status | Evidência |
|---|---|---|
| Testar conversa sem abrir o Tango | ✅ | `liveSimulation.test.ts`, `npm run simulate:live`, `chatConversationGovernor.test.ts`, `test_tango_bridge_send.py` |
| Falha se responder duplicado, furar cooldown ou enviar incerto | ✅ | `liveSimulation.test.ts` → "fails the safety path when replies duplicate, hit cooldown, exceed rate, or OCR confidence is low" |
| Logs suficientes para debugar | ✅ | Snapshot do ciclo auditável em `liveSimulation.test.ts` |

## #168 — Central de IA

| Critério | Status | Evidência |
|---|---|---|
| Em < 10 s dá para saber se o chat real pode ser ligado | ✅ | Bloco "Prontidão da Live" com veredito em uma frase (`LiveReadinessPanel.tsx`, `e2e/central.spec.ts`) |
| Testar dry-run e envio sem trocar de tela | ✅ | Alternância teste/real no topo, fila e prontidão na mesma aba; ligar o real pede confirmação (E2E) |
| Fila de respostas visível durante a live | ✅ | Fila na aba Ao Vivo da Central e no painel unificado |

## #169 — Definição de pronto

| Item | Status |
|---|---|
| IA recebe mensagem do chat | ✅ pela bridge |
| Decisão com fala/resposta/vídeo sem duplicação | ✅ |
| Governador bloqueia spam, baixa confiança, moderação e falta de alvo | ✅ (alvo = bridge conectada/campo validado) |
| Em dry-run tudo testável sem enviar | ✅ status "Simulada" |
| Em modo real, digita e envia no chat do Tango | 🟡 código, testes (inclusive Chromium) e execução de ponta a ponta com a bridge ok; o envio agora é **confirmado no chat**. **Validar uma vez numa live real** (Passo 4 → "Testar envio no chat") |
| Pausa/reduz autonomia quando algo falha | ✅ |
| Operador entende e audita cada decisão | ✅ |
