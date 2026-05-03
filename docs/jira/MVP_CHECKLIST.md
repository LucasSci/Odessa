# Plano de Execução do MVP (Odessa v1.0.0)

Copie e cole este checklist no Slack, no Notion ou nas descrições do Jira para acompanhar o progresso.

## Fase 1: Fundação de Qualidade (Alvo: Sprint 1)

- [ ] **1. Configurar Lints & Formatters**
  - [ ] Frontend: Instalar e configurar `ESLint` e `Prettier`.
  - [ ] Backend: Instalar e configurar `Ruff`.
  - [ ] Criar scripts (`npm run lint`, `npm run format`) e garantir que rodam sem erros.

- [ ] **2. Configurar Testes Unitários no Frontend (Vitest)**
  - [ ] Instalar `Vitest` e dependências.
  - [ ] Cobrir com testes: `src/core/eventClassifier.ts`.
  - [ ] Cobrir com testes: `src/core/personaRuntime.ts` (mockando a fetch API).
  - [ ] Cobrir com testes: `src/core/actionExecutor.ts` (testando os status de tool, simulate e error).

- [ ] **3. Configurar Testes no Backend Python (Pytest)**
  - [ ] Instalar `pytest`, `pytest-asyncio` e `httpx`.
  - [ ] Criar testes para os endpoints principais (`/health`, `/ai/decide`, `/tts`).
  - [ ] Criar testes isolados para extração de JSON e funções utilitárias.

---

## Fase 2: O Desmembramento do Monolito Backend (Alvo: Sprint 3)

- [ ] **1. Refatorar o Arquivo Gigante `server/main.py`**
  - [ ] Criar pasta `server/routes/` e separar as rotas de: OCR, IA, TTS, Project e n8n.
  - [ ] Criar pasta `server/services/` e isolar a lógica do Gemini e OpenAI.
  - [ ] Criar `server/utils.py` para as funções auxiliares.
  - [ ] Testar todos os endpoints para validar que a refatoração não quebrou nada.

- [ ] **2. Implementar Banco de Dados (SQLite)**
  - [ ] Instalar biblioteca `aiosqlite` ou `sqlite3`.
  - [ ] Alterar o sistema atual de "salvar tudo em arquivos JSON soltos" para tabelas SQL estruturadas.
  - [ ] Criar as tabelas base para: Sessões, Ciclos de Auditoria e Logs.

- [ ] **3. Segurança de Resposta das IAs**
  - [ ] Criar modelos rigorosos com a biblioteca `Pydantic`.
  - [ ] Validar a resposta dos LLMs para garantir que o formato JSON esperado (`actions`, `speech`, `confidence`) nunca quebre o bot.

---

## Fase 3: A Desconstrução do Frontend (Alvo: Sprint 2)

- [ ] **1. Criar Biblioteca de UI Compartilhada**
  - [ ] Criar `src/components/ui/`.
  - [ ] Extrair componentes que hoje são repetidos (ex: `StatusDot`, `Pills`, `Sliders`, `Botões de Ação`).

- [ ] **2. Refatorar `CaptureStudio.tsx` (Reduzir linhas)**
  - [ ] Separar e isolar: `VideoPreview`.
  - [ ] Separar e isolar: `ZoneOverlay`.
  - [ ] Separar e isolar: `CaptureControls` e `CaptureEventLog`.

- [ ] **3. Refatorar `AIPersonaTrainer.tsx`**
  - [ ] Separar e isolar: painel de `PersonaProfile` e `VoiceSettings`.
  - [ ] Separar e isolar: `ResponseTimeline` e inputs de teste manual.

- [ ] **4. Refatorar `LiveAutopilotConsole.tsx`**
  - [ ] Separar a lógica de fila (`ActionQueue`) do painel principal.
  - [ ] Extrair os painéis laterais de configuração de "Simulação" e "Ferramentas".

---

## Fase 4: Confiabilidade e Memória (Alvo: Sprint 4)

- [ ] **1. Migração da Memória de Longo Prazo**
  - [ ] Criar endpoints REST no backend para `/memory/turns` e `/users/profiles`.
  - [ ] Alterar o frontend para salvar o contexto no Backend (SQLite) em vez do `localStorage`. O navegador será apenas cache.

- [ ] **2. Resiliência e Fail-Safes (Backend)**
  - [ ] Implementar mecanismo de _Retry Exponencial_ (tentar novamente 3x caso a IA dê erro 500 ou Timeout).
  - [ ] Implementar _Circuit Breaker_ (se o provedor der pau 5 vezes, desarma e espera 1 minuto antes de tentar de novo).

- [ ] **3. Sistema Global de Notificações (Toast)**
  - [ ] Adicionar Toasts/Snackbars no Frontend para exibir mensagens de erro que vêm do Backend de forma amigável.

- [ ] **4. Testes End-to-End (E2E) Básicos**
  - [ ] Configurar o `Playwright`.
  - [ ] Criar um script de teste simulando a navegação real e uma interação completa no Painel Live.
