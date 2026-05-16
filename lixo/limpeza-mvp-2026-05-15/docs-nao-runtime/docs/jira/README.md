# Guia de Importação para Jira

## Arquivos

| Arquivo               | Conteúdo                        | Itens |
| --------------------- | ------------------------------- | ----- |
| `odessa_epics.csv`    | 4 Epics (fases do projeto)      | 4     |
| `odessa_stories.csv`  | Stories vinculadas aos Epics    | 40    |
| `odessa_subtasks.csv` | Sub-tasks vinculadas às Stories | 40    |

**Total: 84 itens**

## Ordem de Importação

> [!IMPORTANT]
> Importe na ordem abaixo. Cada etapa depende da anterior.

### Passo 1 — Importar Epics

1. No Jira, vá em **Project Settings → Import Issues → CSV**
2. Selecione `odessa_epics.csv`
3. Mapeie os campos:
   - `Summary` → Summary
   - `Issue Type` → Issue Type
   - `Priority` → Priority
   - `Epic Name` → Epic Name
   - `Description` → Description
   - `Labels` → Labels _(separador: `;`)_
   - `Fix Version` → Fix Version _(criar se não existir)_
4. Importe e confirme que 4 Epics foram criados

### Passo 2 — Importar Stories

1. Selecione `odessa_stories.csv`
2. Mapeie os campos:
   - `Summary` → Summary
   - `Issue Type` → Issue Type
   - `Priority` → Priority
   - `Epic Link` → Epic Link
   - `Description` → Description
   - `Labels` → Labels _(separador: `;`)_
   - `Story Points` → Story Points
   - `Status` → Status
3. Na tela de mapeamento, verifique que `Epic Link` está vinculando pelo nome do Epic
4. Importe e confirme 40 Stories criadas

### Passo 3 — Importar Sub-tasks

1. Selecione `odessa_subtasks.csv`
2. Mapeie os campos:
   - `Summary` → Summary
   - `Issue Type` → Issue Type
   - `Priority` → Priority
   - `Parent` → Parent _(link pelo Summary da Story)_
   - `Description` → Description
   - `Labels` → Labels _(separador: `;`)_
   - `Story Points` → Story Points
3. Importe e confirme 40 Sub-tasks criadas

## Configuração do Board

### Sprints Sugeridos

| Sprint    | Duração   | Foco                               | Story Points |
| --------- | --------- | ---------------------------------- | ------------ |
| Sprint 1  | 2 semanas | Configurar testes + lint           | ~19 pts      |
| Sprint 2  | 2 semanas | Refatorar frontend (3 componentes) | ~21 pts      |
| Sprint 3  | 2 semanas | Refatorar backend + SQLite         | ~24 pts      |
| Sprint 4  | 2 semanas | Migrar memória + retry + E2E       | ~21 pts      |
| Sprint 5  | 2 semanas | OBS WebSocket + Tango research     | ~21 pts      |
| Sprint 6  | 2 semanas | Media player + Slack + webhooks    | ~18 pts      |
| Sprint 7  | 2 semanas | CI/CD + Auth + Deploy              | ~21 pts      |
| Sprint 8  | 2 semanas | Logging + Security                 | ~10 pts      |
| Sprint 9  | 2 semanas | Mobile + Analytics                 | ~13 pts      |
| Sprint 10 | 2 semanas | Templates + i18n + Polish          | ~18 pts      |
| Sprint 11 | 2 semanas | Avatar + Onboarding + Docs         | ~23 pts      |

### Labels Usados

- `refactor` — Refatoração de código existente
- `frontend` — Trabalho no React/Vite
- `backend` — Trabalho no FastAPI/Python
- `testing` — Testes unitários, integração ou E2E
- `e2e` — Testes end-to-end com Playwright
- `integration` — Integração com sistema externo
- `obs` — Integração com OBS Studio
- `tango` — Integração com Tango Live
- `slack` — Integração com Slack
- `n8n` — Relacionado ao n8n
- `devops` — CI/CD, deploy, infra
- `security` — Autenticação, CORS, rate limiting
- `docs` — Documentação
- `ux` — UX/UI design
- `quality` — Lint, format, validação
- `database` — Persistência e migrations
- `resilience` — Retry, circuit breaker, fallback
- `performance` — Otimização de performance
- `feature` — Nova funcionalidade
- `research` — Investigação/pesquisa
- `polish` — Refinamento visual
- `mobile` — Responsividade mobile
- `analytics` — Métricas e dashboards
- `i18n` — Internacionalização

### Componentes Sugeridos (criar no Jira)

- `Capture Studio` — Extrator OCR
- `Persona Studio` — Configuração e teste de persona
- `Live Console` — Controle Live / Autopilot
- `Backend API` — FastAPI / Python
- `Core Runtime` — Event Bus, Classifier, Action Executor
- `n8n Workflows` — Automações externas
- `Infrastructure` — CI/CD, deploy, monitoring

### Fix Versions

| Version | Significado                               |
| ------- | ----------------------------------------- |
| `1.0.0` | MVP Estável (testado, refatorado, SQLite) |
| `1.1.0` | Integrações Reais (OBS, Tango, Slack)     |
| `1.2.0` | Deploy & Ops (produção)                   |
| `2.0.0` | Produto Final (mobile, analytics, avatar) |

## Notas

- **Separador de labels:** Os CSVs usam `;` como separador de labels. Configure isso no mapeamento do Jira.
- **Story Points:** Calibrados com escala Fibonacci (1, 2, 3, 5, 8, 13). 1 ponto ≈ meio dia de trabalho.
- **Acceptance Criteria:** Incluídos no campo Description de cada Story, prefixados com "AC:".
- **Dependências:** Não é possível importar dependências via CSV. Após importar, vincule manualmente as dependências críticas:
  - "Testes unitários" deve ser concluído antes de "Testes E2E"
  - "Refatorar main.py" deve ser concluído antes de "SQLite"
  - "SQLite" deve ser concluído antes de "Migrar memória"
  - "CI/CD" depende de todos os testes estarem passando
  - "Deploy" depende de "CI/CD" e "Autenticação"
