# Testes

> Visão geral da esteira de qualidade (o que roda no CI e bloqueia o merge):
> `docs/ENGINEERING-STANDARDS.md` §2 e §3. Atalho: `pnpm check`.

## Frontend (Vitest)

```powershell
npm test
```

Rodar uma vez (sem watch):

```powershell
npm test -- --run
```

Testes recomendados para a live simulada e o cockpit:

```powershell
npm test -- --run src/core/liveSimulation.test.ts src/core/liveAutonomyGovernor.test.ts src/core/chatAutomationApi.test.ts src/core/actionExecutor.test.ts src/core/chatReplyQueue.test.ts src/core/liveReadinessSupervisor.test.ts
```

## Backend (pytest)

```powershell
npm run test:backend
```

## Simulação de live

```powershell
npm run simulate:live
```

O script `npm run simulate:live` executa o caminho:

```text
OCR fake -> evento -> decisão -> governador -> fila -> executor -> cloud-agent
```

Ele não depende de Tango, OBS nem OCR real. Use este fluxo para reproduzir uma
conversa com chat e detectar regressão em cooldown, duplicidade, baixa confiança
de OCR e envio sem alvo visual.

## Integração, E2E e mutação

```powershell
pnpm test:unit          # inclui integration/ (sobe o hostinger-server.mjs de verdade)
pnpm build; pnpm test:e2e   # Playwright contra o build de produção
pnpm test:mutation      # Stryker em src/core (lento: semanal no CI)
pnpm test:coverage      # cobertura (pisos em vitest.config.ts)
```

## Arquitetura, código morto e orçamento

```powershell
pnpm arch      # arch-contract (arch-contract.yaml)
pnpm knip      # arquivos/dependências sem uso
pnpm budget    # orçamento de performance do build (performance-budget.json)
```

## Lint e formatação

```powershell
npm run lint        # ESLint
npm run lint:fix    # ESLint com correção automática
npm run format      # Prettier
```

## Build

```powershell
npm run build
```

O frontend compilado fica em `dist/`.
