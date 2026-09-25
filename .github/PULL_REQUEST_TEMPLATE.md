## Issue relacionada

Closes #

<!-- Todo PR resolve (ou avança) uma Issue classificada como Correção, Melhoria ou Nova função.
     Use "Closes #N" para fechar ao mergear, ou "Refs #N" se o PR só avança a issue. -->

## Tipo

- [ ] Correção
- [ ] Melhoria
- [ ] Nova função

## O que mudou

<!-- O que foi alterado e por quê. Foque no comportamento, não em listar arquivos. -->

## Como foi validado

<!-- Comandos executados e o resultado, testes adicionados, validação manual (telas, fluxos). -->

- [ ] `pnpm check` (lint, typecheck, arquitetura, Knip, testes)
- [ ] `pnpm build && pnpm budget`
- [ ] `pnpm test:e2e` (se mexeu em tela)
- [ ] `pytest` (se mexeu no backend)

## Riscos, limitações e próximos passos

- **Riscos:**
- **Limitações:**
- **Próximos passos:**

## Checklist

- [ ] Reutilizei componentes/hooks existentes (`src/components/ui.tsx`, `src/core/*`) em vez de criar outros iguais.
- [ ] Telas novas ou alteradas têm skeleton, entrada/saída suave, estado de progresso e feedback (ver `docs/ENGINEERING-STANDARDS.md` → Motion).
- [ ] Sem segredo, token ou dado pessoal no diff.
- [ ] Documentação atualizada quando o comportamento mudou.
