# Testes

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
