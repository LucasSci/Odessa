# 📊 Análise Completa do Projeto Odessa

**Data da análise:** 03 de Maio de 2026
**Status Geral:** MVP 100% Concluído + Interface Premium | Próximos passos: Testes & Refatoração

---

## 🎯 Resumo Executivo

**Odessa** é uma plataforma criativa para lives: captura texto de tela via OCR, alimenta uma IA persona para gerar respostas contextualizada, e fornece um console de auditoria para validar decisões antes de executar ações reais.

### Onde estamos:

- ✅ **MVP funcional 100%** (conforme relatório de 02 de Maio)
- ✅ **Interface premium dark** com design system moderno
- ✅ **Backend robusto** com FastAPI e múltiplos provedores de IA
- ✅ **Autopilot auditado** pronto para testes em live
- ❌ **Testes automatizados** faltando (Vitest, Pytest)
- ❌ **Refatoração técnica** do backend monolítico pendente
- ❌ **E2E tests** não implementados

---

## ✅ O QUE JÁ FOI FEITO

### 1. **Frontend React/Vite (100% Funcional)**

#### Design & UX

- **Sistema de Design Premium Dark** (`src/index.css`)
  - Glassmorphism com transparências e blur
  - Paleta harmoniosa (Indigo, Pink, Amber, Green)
  - Micro-animações (`pulse-green`, `pulse-node`)
  - Efeitos de glow para profundidade visual

#### Componentes Principais

1. **App.tsx** - Shell de navegação
   - Sidebar com identidade Odessa/Juju
   - Health monitor (Backend, OCR, IA, TTS, n8n)
   - Navegação por hash (#capture, #persona, #content, #runtime)

2. **CaptureStudio.tsx** - Captura OCR multi-zona
   - Seleção de monitor/janela
   - Desenho visual de até 6 zonas de captura
   - Pré-processamento (magnification, contrast, brightness)
   - Envio de imagem base64 para `/ocr`
   - Timeline de eventos capturados

3. **AIPersonaTrainer.tsx** - Configuração da IA
   - Editor editável de persona (prompt customizável)
   - Controles de energia, warmth, safety, temperature
   - Teste manual isolado com `/ai/respond`
   - Configuração de TTS (voice, provider, speed)
   - Histórico de conversa com memória de contexto

4. **LiveAutopilotConsole.tsx** - Console auditado
   - Timeline visual da rodada atual (Entrada → Interpretação → Decisão → Execução → Auditoria)
   - Fila de ações auditável
   - Injection de eventos de teste
   - Simulação de cenários com velocidades variáveis
   - Log estruturado de decisões

5. **OdessaLiveCenter.tsx** - Dashboard principal
   - Hero section com status "Tango-ready"
   - Painéis de direção (Sinais, Persona, Roteiro, IA)
   - Monitor de TTS (transcrição da última fala)
   - Controle de confiança da IA

#### Core System

- `src/core/eventBus.ts` - Event bus para comunicação entre painéis
- `src/core/useAutopilotRuntime.ts` - State management do Autopilot
- `src/core/personaRuntime.ts` - Execução da persona
- `src/core/actionExecutor.ts` - Despacho de ações (speak, chat_reply, ack_gift, etc)
- `src/core/eventClassifier.ts` - Classificação de eventos
- `src/core/longTermMemory.ts` - Persistência de memória em localStorage
- `src/lib/memory.ts` - Gerenciamento de contexto de conversação
- `src/lib/ttsSettings.ts` - Configuração de vozes TTS
- `src/lib/api.ts` - Client HTTP para backend

---

### 2. **Backend FastAPI (100% Funcional)**

#### Endpoints Principais

| Endpoint                 | Método   | Função                                    |
| ------------------------ | -------- | ----------------------------------------- |
| `/health`                | GET      | Verifica saúde do backend (OCR, IA, TTS)  |
| `/ocr`                   | POST     | Processa imagem base64 e retorna texto    |
| `/ai/respond`            | POST     | Resposta simples da persona (sem decisão) |
| `/ai/decide`             | POST     | Decisão estruturada com ações e fala      |
| `/tts`                   | POST     | Sintetiza texto em áudio                  |
| `/tts/voices`            | GET      | Lista vozes disponíveis                   |
| `/tts/test`              | POST     | Teste de voz com texto                    |
| `/n8n/audit`             | POST     | Registra ciclos e decisões (auditoria)    |
| `/n8n/event-ingest`      | POST     | Recebe eventos externos                   |
| `/n8n/action-dispatch`   | POST     | Despacha ações para ferramentas externas  |
| `/project/create-plan`   | POST     | Cria planos de projeto via IA             |
| `/visual-asset/generate` | POST     | Gera imagens para Juju                    |
| `/memory/*`              | GET/POST | Endpoints de memória (testes locais)      |

#### Provedores de IA

- **Gemini (Primário)** - Mais econômico e rápido
- **OpenAI (Fallback)** - gpt-4o-mini como modelo padrão
- Ambos sem exposição de chaves no frontend

#### Provedores de TTS

1. **Edge TTS** (Grátis) - Vozes PT-BR, PT-PT, EN-US, EN-GB
2. **OpenAI TTS** (Premium) - Quando `OPENAI_API_KEY` configurada
3. **Kokoro** (Local) - TTS de alta qualidade localmente
   - Suporta PT-BR, EN-US, EN-GB, JP, CN, ES, FR, HI, IT
   - Requer Python 3.10-3.13 e espeak-ng no Windows

#### Processamento OCR

- **EasyOCR** com suporte a PT e EN
- Processamento de imagem (magnification, contrast, brightness)
- Extração de confiança e latência
- Armazenamento em cache de última leitura por zona

#### Segurança

- CORS configurado para localhost:3000
- X-Odessa-Secret para webhook do n8n
- Sem hardcoding de chaves de API

---

### 3. **Integração n8n (Preparada)**

8 workflows prontos para exportação:

1. **odessa-event-ingest.json** - Entrada de eventos externos
2. **odessa-continuous-organizer.json** - Organização contínua de tarefas
3. **odessa-action-dispatch.json** - Despacho de ações para ferramentas reais (OBS, chat, etc)
4. **odessa-project-creation.json** - Criação de planos de projeto
5. **odessa-night-shift.json** - Preparação de avanços durante pausas
6. **odessa-visual-asset-generator.json** - Geração de imagens com Gemini/OpenAI
7. **odessa-session-summary.json** - Resumo de sessão
8. **odessa-slack-audit.json** - Publicação de planos no Slack

---

### 4. **Configuração & Deploy**

#### Scripts de Inicialização

- ✅ `scripts/start-odessa.ps1` - Inicia backend + frontend em background
- ✅ Atalho no Desktop (`Odessa.lnk`) para inicialização rápida

#### Dependências Python

```
easyocr              # OCR
edge-tts             # TTS grátis
fastapi              # Backend web
google-genai         # IA Gemini
kokoro>=0.9.4        # TTS local
openai               # IA OpenAI
Pillow               # Processamento de imagem
pyautogui            # Captura de tela
uvicorn              # ASGI server
```

#### Dependências Node

```
react                # Frontend framework
vite                 # Build tool
typescript           # Type safety
tailwindcss          # Styling
lucide-react         # Icons
cross-env            # Scripts cross-platform
electron             # Desktop app (opcional)
vitest               # Unit tests (não usado yet)
```

---

## ❌ O QUE AINDA PRECISA SER FEITO

### 📋 Fase 1: Fundação de Qualidade (Estimado: 2-3 sprints)

**Status:** Não iniciada
**Prioridade:** ALTA (Bloqueador para produção)

#### 1.1 - Lints & Formatters ❌

- [ ] Frontend `ESLint` + `Prettier` (scripts prontos, mas não testados)
- [ ] Backend `Ruff` (configuração pronta em `ruff.toml`)
- **Impacto:** Sem isso, código fica desorganizado e hard-to-maintain

**Ações necessárias:**

```bash
# Frontend
npm run lint      # Verificar erros
npm run lint:fix  # Corrigir automaticamente
npm run format    # Padronizar formatação

# Backend
python -m ruff check server/  # Verificar
python -m ruff check server/ --fix  # Corrigir
```

#### 1.2 - Testes Unitários Frontend (Vitest) ❌

- [ ] Configurar Vitest (dependência já existe)
- [ ] Cobrir `src/core/eventClassifier.ts`
- [ ] Cobrir `src/core/personaRuntime.ts` (mock de fetch)
- [ ] Cobrir `src/core/actionExecutor.ts`
- **Impacto:** Sem testes, refatorações futuras quebram features

**Ações necessárias:**

- Criar `src/**/*.test.ts` files com cases de teste
- Adicionar `npm run test` script
- Configurar coverage mínimo (80%)

#### 1.3 - Testes Unitários Backend (Pytest) ❌

- [ ] Configurar pytest (não está em `requirements.txt`)
- [ ] Criar `tests/` com testes para endpoints principais
- [ ] Mockar chamadas de IA (Gemini/OpenAI)
- [ ] Testar OCR, TTS, decisões
- **Impacto:** Backend está sem validação

**Ações necessárias:**

```bash
pip install pytest pytest-asyncio httpx
# Criar test_* files
pytest  # Rodar testes
```

---

### 🔧 Fase 2: Refatoração Técnica Backend (Estimado: 2-3 sprints)

**Status:** Não iniciada
**Prioridade:** ALTA (Manutenibilidade)

#### 2.1 - Desmembramento de `server/main.py` ❌

**Problema:** Arquivo com ~2000+ linhas de código monolítico

**Estrutura proposta:**

```
server/
├── main.py                 # Entry point e middleware
├── config.py               # Variáveis de ambiente
├── models.py               # Pydantic models (já existe)
├── routes/
│   ├── __init__.py
│   ├── ocr.py              # /ocr endpoint
│   ├── ai.py               # /ai/respond, /ai/decide
│   ├── tts.py              # /tts, /tts/voices
│   ├── n8n.py              # /n8n/* endpoints
│   ├── project.py          # /project/* endpoints
│   └── visual.py           # /visual-asset/* endpoints
├── services/
│   ├── __init__.py
│   ├── gemini_service.py   # Integração Gemini
│   ├── openai_service.py   # Integração OpenAI
│   ├── tts_service.py      # TTS (Edge, OpenAI, Kokoro)
│   ├── ocr_service.py      # OCR logic
│   └── memory_service.py   # Persistência
└── utils.py                # Funções auxiliares
```

**Impacto:** Código mais legível, testável, e manutenível

#### 2.2 - Implementação de Banco de Dados (SQLite) ❌

**Problema:** Dados salvos em JSON soltos no disco (`server/runtime/*.json`)

**Proposto:**

- [ ] Instalar `aiosqlite` ou usar `sqlite3`
- [ ] Criar schema SQL para:
  - `sessions` (id, started_at, ended_at, status)
  - `cycles` (id, session_id, round_number, events, decision, actions)
  - `audit_logs` (id, kind, payload, outcome, created_at)
  - `memory_turns` (id, user_id, role, content, created_at)
  - `user_profiles` (id, handle, interaction_count, metadata)
- [ ] Implementar migrations (Alembic ou simples scripts)
- [ ] Expor endpoints `/db/sessions`, `/db/cycles` para leitura

**Impacto:** Rastreabilidade completa, queries estruturadas, backup fácil

#### 2.3 - Validação Rigorosa de Respostas IA ❌

**Problema:** Resposta do Gemini/OpenAI pode quebrar o formato esperado

**Proposto:**

- [ ] Implementar `Pydantic` models mais rigorosos
- [ ] Adicionar retry + fallback se resposta inválida
- [ ] Logging detalhado de erros de parsing
- [ ] Tests para cada provedor (Gemini, OpenAI)

**Impacto:** Autopilot nunca quebra por erro de IA

---

### 💻 Fase 3: Refatoração Frontend (Estimado: 1-2 sprints)

**Status:** Não iniciada
**Prioridade:** MÉDIA (Nice-to-have, código funciona)

#### 3.1 - Biblioteca de Componentes Compartilhados ❌

**Problema:** Componentes repetidos (botões, pills, sliders, status dots)

**Proposto:**

```
src/components/
├── ui/
│   ├── Button.tsx
│   ├── StatusDot.tsx
│   ├── Pills.tsx
│   ├── Slider.tsx
│   ├── Card.tsx
│   ├── Badge.tsx
│   └── Dialog.tsx
└── ...componentes existentes
```

**Impacto:** Reutilização, consistência visual

#### 3.2 - Decomposição de CaptureStudio.tsx ❌

**Problema:** Arquivo com ~600+ linhas

**Proposto quebrar em:**

- `VideoPreview.tsx` - Preview da captura
- `ZoneOverlay.tsx` - Desenho de zonas
- `CaptureControls.tsx` - Botões de controle
- `CaptureEventLog.tsx` - Timeline de eventos
- `CaptureSettings.tsx` - Configurações

**Impacto:** Mais fácil testar e reutilizar

#### 3.3 - Decomposição de AIPersonaTrainer.tsx ❌

**Problema:** Arquivo com ~800+ linhas

**Proposto quebrar em:**

- `PersonaProfile.tsx` - Editor de persona
- `VoiceSettings.tsx` - Configuração de TTS
- `ResponseTimeline.tsx` - Histórico de respostas
- `ManualTestPanel.tsx` - Teste manual

**Impacto:** Manutenção mais fácil, reutilização

#### 3.4 - Decomposição de LiveAutopilotConsole.tsx ❌

**Problema:** Arquivo com ~1000+ linhas

**Proposto quebrar em:**

- `ActionQueue.tsx` - Fila de ações
- `SimulationPanel.tsx` - Controles de simulação
- `TimelineView.tsx` - Timeline visual
- `EventInjector.tsx` - Injection de testes

**Impacto:** Testável, componível

---

### 🧠 Fase 4: Resiliência e Memória (Estimado: 2-3 sprints)

**Status:** Não iniciada
**Prioridade:** ALTA (Produção)

#### 4.1 - Migração de Memória para Backend ❌

**Problema:** Memória guardada em `localStorage` (navegador)

**Proposto:**

- [ ] Criar endpoints `/memory/turns` e `/memory/users` no backend
- [ ] Migrar do `localStorage` para SQLite
- [ ] Frontend apenas cache, backend é source-of-truth
- [ ] Sincronização automática

**Impacto:** Memória persistente entre sessões e dispositivos

#### 4.2 - Resiliência Backend (Retry + Circuit Breaker) ❌

**Problema:** Se IA cair, Odessa para

**Proposto:**

- [ ] Implementar retry exponencial (3x com backoff)
- [ ] Circuit breaker (falhas 5x → espera 1 min)
- [ ] Fallback automático Gemini → OpenAI
- [ ] Health checks periódicos

**Impacto:** Sistema robusto em produção

#### 4.3 - Sistema Global de Notificações ❌

**Problema:** Erros aparecem no console, usuário não vê

**Proposto:**

- [ ] Adicionar Toast/Snackbar library (ex: `sonner`, `react-hot-toast`)
- [ ] Middleware que converte erros HTTP em notificações
- [ ] Status de conectividade com backend

**Impacto:** UX melhorada, usuário sabe o que aconteceu

#### 4.4 - Testes E2E (Playwright) ❌

**Problema:** Sem validação end-to-end

**Proposto:**

- [ ] Configurar Playwright
- [ ] Criar testes simulando fluxo real:
  1. Selecionar tela
  2. Desenhar zona OCR
  3. Capturar e enviar imagem
  4. Verificar resposta da IA
  5. Validar TTS
  6. Testar Autopilot com evento simulado

**Impacto:** Confiança de que sistema funciona

---

## 📊 Matriz de Priorização

| Fase | Task                  | Impacto | Complexidade | Estimado | Bloqueia       |
| ---- | --------------------- | ------- | ------------ | -------- | -------------- |
| 1.1  | Lints & Formatters    | ALTO    | BAIXA        | 0.5 dias | Produção       |
| 1.2  | Testes Frontend       | ALTO    | MÉDIA        | 3-4 dias | Refatoração    |
| 1.3  | Testes Backend        | ALTO    | MÉDIA        | 3-4 dias | Refatoração    |
| 2.1  | Refatorar Backend     | ALTO    | ALTA         | 5-7 dias | Escalabilidade |
| 2.2  | SQLite + Migrations   | ALTO    | ALTA         | 5-7 dias | Persistência   |
| 2.3  | Validação IA          | ALTO    | MÉDIA        | 2-3 dias | Produção       |
| 3.1  | UI Components Lib     | MÉDIO   | BAIXA        | 2-3 dias | Manutenção     |
| 3.2  | Decomposição Frontend | MÉDIO   | MÉDIA        | 3-4 dias | Manutenção     |
| 3.3  | Decomposição Persona  | MÉDIO   | MÉDIA        | 2-3 dias | Manutenção     |
| 3.4  | Decomposição Console  | MÉDIO   | ALTA         | 4-5 dias | Manutenção     |
| 4.1  | Memória Backend       | ALTO    | MÉDIA        | 3-4 dias | Persistência   |
| 4.2  | Resiliência           | ALTO    | MÉDIA        | 3-4 dias | Produção       |
| 4.3  | Notificações          | MÉDIO   | BAIXA        | 1-2 dias | UX             |
| 4.4  | E2E Tests             | MÉDIO   | ALTA         | 5-7 dias | QA             |

---

## 🎯 Roadmap Recomendado

### **Sprint Atual (Semana 1-2)**

1. Configurar ESLint/Prettier (0.5 dia)
2. Testes unitários básicos (1 componente por arquivo) - 2 dias
3. Testes backend `/health`, `/ocr` - 2 dias

### **Sprint 2 (Semana 3-4)**

1. Refatorar `server/main.py` em módulos - 4 dias
2. Começar decomposição do frontend - 3 dias

### **Sprint 3 (Semana 5-6)**

1. Implementar SQLite + migrations - 4 dias
2. Criar endpoints de memória - 2 dias
3. Terminar decomposição frontend - 3 dias

### **Sprint 4 (Semana 7-8)**

1. Circuit breaker + retry - 2 dias
2. Toast notifications - 1 dia
3. E2E tests básicos - 3 dias
4. Buffer/contingência - 1 dia

---

## 🚀 Roadmap de Features (Pós-MVP)

Quando os testes estiverem prontos, considere:

1. **Avatar Animado** (Juju visual)
   - Integração com modelos de lipsync (ex: Replicate)
2. **Automação Real** (não simulada)
   - WebSocket para OBS Studio
   - Chat API do Tango Live
   - Integração com Spotify/YouTube
3. **Multi-Persona**
   - Suporte a várias personas customizadas
   - Troca dinâmica de persona durante live
4. **Analytics Dashboard**
   - Métricas de engagement
   - Heatmap de momentos com mais energia
   - Relatórios de performance
5. **Mobile Companion**
   - App React Native para controlar Odessa remotamente
   - Notificações de decisões críticas

---

## 🏁 Checklist Final

Antes de ir para produção com Odessa, certifique-se de:

- [ ] Todos os lints passando
- [ ] Coverage de testes ≥ 80% (frontend e backend)
- [ ] Nenhuma chave de API exposta no código
- [ ] Todos os endpoints testados E2E
- [ ] Documentação atualizada (README, APIs, setup)
- [ ] Plano de backup dos dados (SQLite)
- [ ] Monitoramento de erros (ex: Sentry)
- [ ] Performance profiling feito
- [ ] Testes de carga do backend
- [ ] Aprovação de security review

---

## 📞 Resumo Executivo para Stakeholders

> **Odessa já é um produto funcional e pronto para testes em live.** O MVP foi concluído com sucesso e inclui captura OCR, persona IA, TTS multi-provider e console de auditoria.
>
> Os próximos passos focam em **solidificar a base técnica**: testes automatizados, refatoração de código monolítico, e migração de dados para um banco de dados estruturado. Estima-se **4-6 semanas** para atingir nível de produção com confiança.
>
> Dessa forma, Odessa pode ser operada 24/7 em lives reais sem riscos técnicos significativos.

---

**Documento preparado para:** Lucas
**Próximo review:** 1 semana
**Contact:** GitHub Copilot (Odessa Dev)
