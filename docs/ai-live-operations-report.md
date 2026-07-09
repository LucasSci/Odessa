# Relatorio operacional da Central de IA

Data da verificacao: 2026-07-09 17:12:49 -03:00
Branch: `main`

## Resumo

A Central de IA agora tem tres capacidades operacionais principais:

- Auditoria completa por rodada, com timeline de captura, classificacao, decisao, governador e execucao.
- Ambiente de teste para live completa sem Tango, OBS ou OCR real.
- Cockpit da Central de IA para decidir rapidamente se o chat real pode ser ligado com seguranca.

## Programa rodado

O app local estava respondendo durante a verificacao:

- Painel: `http://localhost:3000`
- Backend health: `http://localhost:8000/health`

Comandos executados:

```powershell
npm run build
npm test -- --run src/core/liveSimulation.test.ts src/core/liveAutonomyGovernor.test.ts src/core/chatAutomationApi.test.ts src/core/actionExecutor.test.ts src/core/chatReplyQueue.test.ts src/core/liveReadinessSupervisor.test.ts
npm run simulate:live
```

Resultado:

- Build Vite: aprovado.
- Testes Vitest: 6 arquivos aprovados, 26 testes aprovados, 7 ignorados.
- Simulacao E2E: aprovada, cobrindo OCR fake -> evento -> decisao -> governador -> fila -> executor -> cloud-agent.

## Modificacoes por entrega

### Auditoria e replay de rodada

Commit: `e6b643e Add live audit timeline and replay`

Arquivos alterados:

- `src/OdessaLiveCenter.tsx`
- `src/core/actionExecutor.ts`
- `src/core/personaRuntime.ts`
- `src/core/useAutopilotRuntime.ts`
- `src/types.ts`

O que mudou:

- Cada rodada da Diretora registra uma timeline auditavel.
- A timeline mostra eventos capturados, classificacao, decisao da IA, aplicacao do governador e execucao.
- Cada acao exposta na auditoria carrega payload e modo operacional: `simulated`, `approval_required` ou `real`.
- O resultado da automacao de chat fica visivel como `dry-run`, `queued`, `sent`, `blocked` ou `error`.
- A tela da live ganhou filtros por tipo de evento: chat, presente, video, OBS, moderacao e erro.
- A sessao pode ser exportada em JSON com eventos, decisoes, acoes e erros.
- Rodadas podem ser reexecutadas em modo de teste, sem assumir execucao real.

Impacto operacional:

- Depois de erro, o operador consegue localizar se a falha aconteceu na captura, classificacao, decisao, governador ou execucao.
- O replay permite reproduzir uma rodada fora da live.

### Simulacao completa de live

Commit: `7a01b59 Add fake live simulation test harness`

Arquivos alterados:

- `package.json`
- `scripts/simulate-live-round.mjs`
- `src/OdessaLiveCenter.tsx`
- `src/core/__fixtures__/liveSimulationFixtures.ts`
- `src/core/chatAutomationApi.test.ts`
- `src/core/liveSimulation.test.ts`

O que mudou:

- Foram criadas fixtures para chat, presentes, alertas, moderacao e baixa confianca de OCR.
- `runPersonaRound` agora e testado com Diretora mockada e decisoes previsiveis.
- `governPersonaDecision` e testado para cooldown, limite por minuto, baixa confianca e alvo visual ausente.
- `/chat-automation/send` e testado nos modos dry-run, real local e cloud-agent queued.
- O comando `chat.send_visual` e coberto da geracao ao consumo pelo agente local.
- O script `npm run simulate:live` executa uma rodada E2E sem depender de Tango, OBS ou OCR real.
- Snapshots dos ciclos auditaveis detectam regressao na forma dos logs.

Impacto operacional:

- E possivel testar conversa com chat sem abrir a Tango.
- O teste falha se a IA responder duplicado, furar cooldown ou enviar com OCR incerto.
- O fluxo gera logs suficientes para depurar uma live real.

### Cockpit da Central de IA

Commit: `e504c3b Refine AI central live chat cockpit`

Arquivo alterado:

- `src/components/AiConfigPanel.tsx`

O que mudou:

- A Central de IA ganhou um bloco superior de estado operacional: pronto, atencao, bloqueado ou simulado.
- O bloco `Prontidao da Live` mostra Gemini, OCR, OBS, Agente Local, alvo visual e autonomia.
- O bloco `Chat Autonomo` mostra modo dry-run/real, cooldown, limite por minuto e confianca minima.
- O bloco `Acoes Pendentes` deixa visivel a fila publica com aprovar, editar, enviar agora e descartar.
- Foi adicionado CTA de calibracao visual do chat.
- O modo de envio real mostra aviso forte antes de a Diretora poder publicar.
- A interface exibe ultima resposta enviada, ultima bloqueada e motivo do bloqueio.

Impacto operacional:

- O operador consegue entender rapidamente se o envio real pode ser ligado.
- Dry-run, envio e fila publica ficam disponiveis sem trocar de tela.
- O cockpit reduz risco de publicar no chat sem Gemini, OCR, alvo visual, agente local ou autonomia em estado seguro.

## Como validar novamente

Para abrir o ambiente local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1
```

Para validar a parte automatizada:

```powershell
npm run build
npm test -- --run src/core/liveSimulation.test.ts src/core/liveAutonomyGovernor.test.ts src/core/chatAutomationApi.test.ts src/core/actionExecutor.test.ts src/core/chatReplyQueue.test.ts src/core/liveReadinessSupervisor.test.ts
npm run simulate:live
```

## Observacoes

- A pasta `.codex/` segue local e nao foi versionada.
- A checagem visual automatizada por Playwright nao foi usada neste relatorio porque o projeto nao declara Playwright nas dependencias locais.
- O estado publicado no GitHub esta na branch `main`.
