# Inventário de dados tratados pelo Odessa

> **Documento técnico de apoio ao jurídico (issue #248). Não é Termo de Uso
> nem Política de Privacidade.** Descreve o que o sistema coleta, onde guarda,
> por quanto tempo e com quem compartilha, com base no código em 2026-09.
> Os textos legais só podem ser publicados depois de aprovação jurídica
> registrada na issue #248.

## 1. Quem são os titulares

| Titular | Relação com o Odessa |
|---|---|
| **Espectadores da live** (chat do Tango) | Têm nome de usuário e mensagens lidos pela bridge; recebem respostas da persona. Não fazem cadastro nem aceitam termos do Odessa. |
| **Operador / administrador** | Usa o painel; credenciais de admin configuradas no servidor. |
| **Pessoa retratada pela persona** (se houver) | Fotos de rosto/ambiente enviadas como assets de persona e usadas para gerar imagens e vídeos. |

## 2. Dados, finalidade, local e retenção

| Dado | Finalidade | Onde fica | Retenção hoje | Código |
|---|---|---|---|---|
| Nome de usuário e texto das mensagens do chat | Mostrar o feed, decidir e gerar respostas | Memória do navegador (últimas 400) | Até fechar a página | `src/core/tangoChatSession.tsx` |
| Histórico da sessão (texto das mensagens a que a IA respondeu ou deixou de responder, **sem máscara** e inclusive as de moderação; presentes; respostas; motivos de bloqueio) | Auditoria e exportação JSON/CSV | Arquivos em `server/runtime/session-history/` | **Indefinida** (sem limpeza automática) | `server/services/session_history.py` |
| Perfil por usuário do chat: nº de mensagens, nº de presentes, últimas interações (texto) | Reconhecer recorrência nas respostas (#165) | SQLite `server/runtime/odessa.db` (tabelas `users`, `interaction_logs`) | **Indefinida** até "Resetar aprendizado" ou exclusão do perfil | `server/services/memory_service.py`, `src/core/chatMemory.ts` |
| Tendências do chat (tópicos, pedidos, elogios agregados) | Contexto da IA | `localStorage` do navegador (`odessa:chat-learning:v1`) | Até "Resetar aprendizado" | `src/core/chatLearning.ts` |
| Fatos por espectador (ex.: `pedido: …`, `gosta: …`, com o nome do espectador) | Contexto da Diretora | `localStorage` (`odessa:rag-memory:v1`) | **Indefinida e sem teto.** Hoje **não** é apagado por "Resetar aprendizado" nem por "Esquecer" (correção em #254) | `src/core/longTermMemory.ts`, `src/core/chatLearning.ts` |
| Últimos eventos da live (mensagens com nome, presentes) | Rodadas da Diretora | `localStorage` (`odessa:event-bus:v1`) | Últimos 200 eventos | `src/core/eventBus.ts` |
| Respostas da IA enviadas/bloqueadas (texto da resposta e motivo) | Limites de ritmo e auditoria | `localStorage` (`odessa:auto-chat:history:v1`, `odessa:audit-session:v1`) | Últimas 80 | `src/core/liveAutonomyGovernor.ts`, `src/core/personaRuntime.ts` |
| Conversas do laboratório (operador ↔ persona) | Testar a persona | `localStorage` (`odessa.conversationLab.*`) | Últimas 200 mensagens por persona | `src/core/conversationLab.ts` |
| Token de sessão do painel | Manter o operador logado | `localStorage` (`odessa:admin-session-token:v1`) | Até sair ou o token expirar | `src/LoginScreen.tsx`, `src/lib/autoLogin.ts` |
| Mensagens com e-mail/telefone | — | São **mascaradas** antes de ir para a memória; mensagens de moderação (links, contatos, golpes) não são guardadas | — | `src/core/chatMemory.ts` |
| Sessão logada do Tango (cookies do navegador da bridge) | Ler e escrever no chat da live | Perfil do Chromium da bridge (`PROFILE_DIR`) na máquina da live | Até apagar o perfil | `tango_chat/tango_chat.py` |
| Fotos e assets de persona | Identidade visual e geração de mídia | Pastas de persona no servidor | Até remoção pelo operador | `server/core/persona_assets.py` |
| Credenciais de admin, chaves de API, senha do OBS | Operação | Variáveis de ambiente / arquivos locais de configuração | Enquanto configuradas | `server/core/auth.py`, `.env.example` |
| Erros técnicos (se Sentry ativo) | Diagnóstico de falhas | Sentry (terceiro) | Conforme plano do Sentry | `src/lib/observability.ts`, `server/core/observability.py` |

## 3. Compartilhamento com terceiros

| Terceiro | O que recebe | Quando |
|---|---|---|
| **Google (Gemini)** | Prompt da persona, histórico recente do chat (nomes e mensagens), mensagem a responder, resumo de memória | Provedor de IA = Gemini |
| **OpenAI / RouteLLM (Abacus)** | O mesmo conteúdo acima | Quando configurados no backend |
| **Anthropic (Claude)** | O mesmo conteúdo acima | Provedor de IA = Claude |
| **Ollama (local)** | O mesmo conteúdo, **sem sair da máquina** | Provedor padrão |
| **Microsoft (edge-tts)** | Texto das falas da persona | Voz ligada |
| **Higgsfield** | Fotos da persona e prompts | Geração de imagem/vídeo |
| **Tango** | Mensagens enviadas pela persona no chat | Envio real ligado |
| **n8n / webhooks configurados** | Eventos da live conforme o fluxo | Quando o operador configura |
| **Sentry** | Erros técnicos, **sem** usuário, cookies, cabeçalhos, corpos HTTP ou mensagens do chat | Só com `SENTRY_DSN` |
| **Hostinger** | Frontend e API em nuvem | Deploy em nuvem |

Vários desses provedores processam dados fora do Brasil (transferência internacional).

## 4. Controles que já existem

- Reset do aprendizado (tendências + memória por usuário no backend) na Central da Live → Diagnóstico → Insights. Os fatos por espectador no navegador ainda ficam (#254).
- Ver, ocultar ou esquecer um espectador específico na Central da Live → Diagnóstico → Insights → "Espectadores na memória" (#252). Ocultar tira o espectador do contexto da IA sem apagar; esquecer apaga perfil e interações (`DELETE /api/v1/memory/profiles/{usuario}`).
- Mascaramento de e-mail/telefone e descarte de mensagens de moderação antes de guardar.
- Sentry opt-in e sem dados pessoais.
- Modo teste (dry-run): nada é enviado no chat.

## 5. Perguntas para o jurídico

1. Base legal (LGPD) para tratar nome e mensagens de espectadores que não aceitaram termos do Odessa — legítimo interesse? É preciso aviso na live?
2. Prazo de retenção para histórico da sessão e memória por usuário (hoje indefinidos).
3. Como atender pedidos de acesso/exclusão de um espectador (canal, prazo).
4. Transferência internacional para provedores de IA (Google, OpenAI, Anthropic) e voz (Microsoft).
5. Uso de imagem da pessoa retratada pela persona (consentimento, cessão).
6. Conformidade da automação de chat com os Termos do Tango.
7. Tratamento de possíveis menores de idade no chat.
8. Quem é o controlador (operador da live? mantenedor do Odessa?) em cada cenário de uso.

## 6. Próximos passos técnicos (dependem das respostas acima)

- Retenção automática configurável para histórico e memória.
- ~~Links para Termos e Política no login e no rodapé, com versão e data de aprovação.~~ Mecanismo pronto e travado até a aprovação: ver `docs/legal/README.md`.
