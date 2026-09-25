# Padrões de engenharia do Odessa

Fonte única das regras de trabalho para **qualquer pessoa ou agente** (Claude
Code, Codex ou outro modelo). `CLAUDE.md` e `AGENTS.md` apontam para cá. Leia
antes de implementar qualquer mudança.

---

## 1. Fluxo de trabalho: Issue → Pull Request → merge → deploy

1. **Toda tarefa começa numa Issue** no GitHub, classificada como:
   | Tipo | Label | Quando |
   |---|---|---|
   | Correção | `correcao` | algo que deveria funcionar e não funciona |
   | Melhoria | `melhoria` | algo que existe e pode ficar melhor (UX, desempenho, qualidade, processo) |
   | Nova função | `nova-funcao` | capacidade que o sistema ainda não tem |

   Use os templates em `.github/ISSUE_TEMPLATE`. Antes de criar, procure se já
   existe uma issue igual. Achou um problema fora do escopo do que está fazendo?
   Abra outra issue em vez de resolver no mesmo PR.
2. **Trabalhe numa branch**, nunca direto na `main`.
3. **Abra um Pull Request** para a `main`. O template
   (`.github/PULL_REQUEST_TEMPLATE.md`) é obrigatório e precisa ter:
   - a **Issue relacionada** (`Closes #N` ou `Refs #N`);
   - **o que mudou** (comportamento, não lista de arquivos);
   - **como foi validado** (comandos e resultados, testes, validação manual);
   - **riscos, limitações e próximos passos**.
4. **Commits** seguem Conventional Commits, com descrição em português
   (validado pelo Commitlint no CI):
   `feat:` Nova função · `fix:` Correção · `refactor:`/`perf:`/`style:`/`docs:`/`test:`/`build:`/`ci:`/`chore:` Melhoria.
   Ex.: `fix(live): cancelar resposta pendente ao encerrar a live (#123)`.
5. **Merge só com a esteira verde** (seção 2).
6. **Deploy só a partir da `main`**, depois do merge (ver `CLAUDE.md` → Deploy).

---

## 2. Esteira de qualidade (obrigatória antes do merge)

Rode localmente antes de abrir/atualizar o PR:

```bash
pnpm check              # lint + typecheck + arquitetura + Knip + testes unitários/integração
pnpm build && pnpm budget
pnpm test:e2e           # se mexeu em tela (precisa do build)
```

No CI (`.github/workflows/ci.yml`), todo PR para a `main` roda:

| Job / passo | Ferramenta | O que bloqueia |
|---|---|---|
| `commitlint` | Commitlint | commit fora do padrão |
| Lint | ESLint (inclui as regras do React Compiler: `react-hooks/*`) | qualquer erro. Não use `eslint-disable` nem arquivo de supressões para passar: corrija a causa |
| Type check | `tsc --noEmit` | erro de tipo |
| Architecture contract | **arch-contract** (`arch-contract.yaml`) | violação de camada (seção 6) |
| Knip | **Knip** (`knip.json`) | arquivo ou dependência sem uso, dependência não declarada |
| Unit tests with coverage | Vitest + v8 | teste falhando ou cobertura abaixo do piso |
| Build + Performance budget | `performance-budget.json` | chunk acima do orçamento |
| Dependency audit | `pnpm audit` | vulnerabilidade alta/crítica em dependência de produção |
| Codecov | **Codecov** (`codecov.yml`) | total cair > 1 ponto; código novo do PR < 70% coberto |
| `e2e` | **Playwright** | fluxo quebrado no navegador |
| `backend-tests` | pytest + cobertura | teste do backend falhando |
| CodeQL | CodeQL (JS/TS + Python) | alerta de segurança |

Semanal/sob demanda: **Stryker** (testes de mutação em `src/core`, `.github/workflows/mutation.yml`).

**Proteção da `main`** (configurar em *Settings → Branches* do repositório):
exigir PR, exigir os checks acima como obrigatórios e bloquear push direto.

---

## 3. Testes

| Camada | Onde | Comando |
|---|---|---|
| Unitários (frontend) | `src/**/*.test.ts(x)` | `pnpm test:unit` |
| Integração (servidor de produção real) | `integration/**/*.test.ts` | `pnpm test:unit` |
| End-to-end | `e2e/*.spec.ts` | `pnpm build && pnpm test:e2e` |
| Backend | `server/tests`, `tests/` | `PYTHONPATH=. pytest server/tests tests` |
| Mutação | `stryker.config.mjs` | `pnpm test:mutation` |
| Cobertura | `coverage/` | `pnpm test:coverage` |

- Correção sempre vem com um teste que falharia sem ela.
- Cobertura tem **catraca**: os pisos em `vitest.config.ts` só sobem.
- Endtest não é usado: o Playwright cobre o mesmo escopo em código versionado.

---

## 4. Observabilidade

- **Sentry** no frontend (`src/lib/observability.ts`) e no backend
  (`server/core/observability.py`). **Opt-in**: sem `VITE_SENTRY_DSN` /
  `SENTRY_DSN`, nada é carregado nem enviado. O SDK do navegador é um chunk lazy.
- Nunca envie dados pessoais: usuário, cookies, cabeçalhos, corpos HTTP e
  mensagens do chat ficam de fora (já configurado — não afrouxe).
- Erros tratados: `reportError(error, contexto)`. Erros de render: o
  `ErrorBoundary` já cobre o app e cada página do shell.
- **OpenTelemetry**: próximo passo quando houver um coletor. **Datadog / New
  Relic**: não adotados (custo e sobreposição com o Sentry no porte atual).

---

## 5. Segurança e operação

- **Rate limit**: por IP em `hostinger-server.mjs` (API 600/min, login 10/min,
  `429` + `Retry-After`) e no login do FastAPI. Endpoint novo caro (IA, upload,
  envio) precisa de limite próprio — reutilize `server/core/rate_limit.py`.
- **Revisão de segurança**: CodeQL no CI; mudanças em auth, upload, proxy,
  webhooks ou execução de comandos pedem revisão humana explícita no PR.
- **Segredos** nunca no código, no diff, em logs ou no Sentry. Use `.env`
  (documente a variável em `.env.example`).
- **Performance budget**: `performance-budget.json`. Subir um limite exige
  justificativa no PR. Prefira lazy loading (`React.lazy` + `PanelSkeleton`).
- **Separação backend/frontend**: o frontend fala com o backend **só por HTTP**
  (`src/lib/api.ts`, `apiFetch`). Garantido pelo arch-contract e pelo lint.
- **Termos de uso e Política de privacidade**: só publicados depois de revisados
  e **aprovados pelo jurídico** (issue #248). Agentes não redigem nem publicam
  texto legal final por conta própria. O inventário técnico de dados para o
  jurídico está em `docs/legal/INVENTARIO-DE-DADOS.md` — atualize-o sempre que
  um dado novo for coletado, guardado ou enviado a um terceiro.

---

## 6. Arquitetura

Camadas (validadas por `pnpm arch`):

```
src/*.tsx, src/components/**   (ui)   → pode usar core
src/core/**, src/lib/**        (core) → não importa ui
src/**                                → nunca importa server/ nem api/
api/**/*.js                           → autocontido: não importa src/ nem server/ (lint)
server/**                             → backend FastAPI (Python)
```

Princípios:

- **Evite overengineering.** Resolva o problema de hoje com o menor código
  claro possível. Nada de abstração "para o futuro", camadas extras ou
  configuração que ninguém pediu.
- **Evite bottlenecks.** Nada de trabalho pesado síncrono no render ou no
  handler; polling só enquanto a página está ativa (`usePageActive`/`usePolling`);
  listas longas não re-renderizam inteiras a cada evento.
- **Componentize desde o início**: tela nova é composta de componentes pequenos.
- **DRY com critério**: extraia na **terceira** repetição, ou antes se a
  duplicação já causou bug. Duas coisas parecidas que mudam por motivos
  diferentes não são duplicação.
- **Não reconstrua o que já existe.** Antes de criar um componente/hook, procure:

  | Precisa de… | Use |
  |---|---|
  | Botão (com `loading`), botão com confirmação, abas, badge, input, tooltip, menu "Mais" | `src/components/ui.tsx` (`Button`, `ConfirmButton`, `Tabs`, `Badge`, `Input`, `Tooltip`, `OverflowMenu`) |
  | Modal / diálogo | `Modal` em `ui.tsx` |
  | Carregamento | `Skeleton`, `SkeletonList`, `PanelSkeleton` em `ui.tsx` |
  | Vazio / erro | `EmptyState`, `ErrorState` em `components/common/OperationalState.tsx` |
  | Aviso ao usuário | `useToast()` (`components/Toast.tsx`) |
  | Entrada/saída animada | `usePresence()` (`core/usePresence.ts`) + classes `.od-pop`/`.od-backdrop` |
  | Chamada ao backend | `apiFetch()` / `httpErrorMessage()` (`lib/apiFetch.ts`) |
  | Polling | `usePolling()` (`core/usePolling.ts`) |
  | Foco em diálogo | `useModalFocus()` (`core/useModalFocus.ts`) |
  | `localStorage` seguro | `lib/safeStorage.ts` |

  O Knip acusa exports duplicados e código morto; a revisão do PR confere o resto.

---

## 7. Interface e motion

Siga a skill **Design Motion Principles** (`.claude/skills/design-motion-principles`,
de kylezantos/design-motion-principles). O Odessa é uma ferramenta usada por
horas durante uma live → lente **Emil** (primária: rápido, discreto, com
propósito), **Jakub** (secundária: acabamento), **Jhey** só em estados vazios.

Toda interface nova ou alterada precisa ter:

| Requisito | Como |
|---|---|
| Lazy loading quando fizer sentido | páginas/painéis pesados via `React.lazy`; imagens com `loading="lazy"` |
| Skeleton no carregamento | `PanelSkeleton` (fallback de `Suspense`) e `SkeletonList` — nunca só o texto "Carregando…" |
| Entrada e saída suaves | `usePresence` + `.od-pop`/`.od-backdrop`/`.od-toast`; saída mais curta e sutil que a entrada |
| Estado de progresso em elementos interativos | `Button loading` (spinner + `aria-busy`), `ConfirmButton` com contagem |
| Feedback visual de ação | `useToast()` para resultado; press `scale(0.97)` já é global |
| Transições consistentes | só os tokens abaixo — nada de durações/curvas soltas |

Tokens (`src/ux-polish.css` §9):

| Token | Valor | Uso |
|---|---|---|
| `--motion-enter` | 200 ms, `--ease-out` | algo aparece |
| `--motion-exit` | 140 ms, `--ease-exit` | algo some |
| `--motion-state` | 160 ms | hover, cor, aba |

Regras:

- **Frequência decide**: ação feita centenas de vezes (navegação, chat, atalhos
  de teclado) não anima ou só troca cor. Atalho de teclado nunca anima (por isso
  a paleta Ctrl+K abre sem animação).
- Deslocamento ≤ 8 px; nunca animar a partir de `scale(0)` (mínimo 0.96).
- Anime só `transform` e `opacity` (nunca `width`/`height`/`top`/`left`).
- Sem loops decorativos, sem bounce/overshoot em ação utilitária, sem
  hover-lift em tudo, sem stagger em toda lista. Pulso só para "ao vivo".
- `prefers-reduced-motion` é respeitado globalmente (`ux-polish.css` §3) — não
  crie animação que dependa de terminar para o conteúdo ficar visível.
- Transform/fill-mode em contêiner com modais `position: fixed` dentro quebra o
  posicionamento: para trocar conteúdo use `.anim-content-swap` (só opacidade).
- Erro para o usuário é frase legível, nunca JSON cru nem só "HTTP 502".

Antes de concluir uma tela, revise como designer de produto sênior: rode o app,
passe por carregamento lento, vazio, erro e sucesso, e corrija o que parecer
brusco, travado, genérico ou amador.

---

## 8. Ferramentas avaliadas e não adotadas (por enquanto)

| Ferramenta | Motivo |
|---|---|
| Biome | Duplicaria ESLint + Prettier, já configurados e com regras de React Hooks que o Biome não cobre igual |
| Datadog, New Relic | Custo e sobreposição com o Sentry para o porte atual |
| Endtest | Playwright cobre o mesmo escopo em código versionado e roda no CI |
| OpenTelemetry | Próximo passo quando houver coletor de traces |
