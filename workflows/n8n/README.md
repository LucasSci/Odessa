# Odessa n8n Workflows

Use estes workflows como pacote inicial de automacao externa do Odessa.

## Como usar

1. Rode `npm run dev:n8n`.
2. Abra `http://localhost:5678`.
3. Importe os arquivos `.json` desta pasta.
4. Ative os workflows no n8n e copie as URLs de webhook para o `.env` local:
   - `N8N_AUDIT_WEBHOOK_URL`
   - `N8N_ACTION_WEBHOOK_URL`
   - `N8N_EVENT_INGEST_WEBHOOK_URL`
   - `N8N_PROJECT_CREATION_WEBHOOK_URL`
   - `N8N_NIGHT_SHIFT_WEBHOOK_URL`
   - `N8N_VISUAL_ASSET_WEBHOOK_URL`
5. Use o mesmo `N8N_WEBHOOK_SECRET` no backend e no header `X-Odessa-Secret` dos workflows que chamam o Odessa.
6. Opcional: defina `N8N_SLACK_WEBHOOK_URL` no ambiente do processo n8n para o pipeline de criacao publicar automaticamente no Slack.

Na maquina local atual, os webhooks ativos usam:

- `http://localhost:5678/webhook/odessa/audit`
- `http://localhost:5678/webhook/odessa/action-dispatch`
- `http://localhost:5678/webhook/odessa/event-ingest`
- `http://localhost:5678/webhook/odessa/project-create`
- `http://localhost:5678/webhook/odessa/night-shift`
- `http://localhost:5678/webhook/odessa/continuous-organizer`
- `http://localhost:5678/webhook/odessa/visual-assets`

Os workflows chamam o backend por `http://127.0.0.1:8000` para evitar falhas de IPv6 no Windows.

## Workflows

- `odessa-slack-audit.json`: recebe ciclos e erros, escolhe o canal Slack alvo e prepara o payload de auditoria.
- `odessa-action-dispatch.json`: recebe acoes externas da Persona e roteia por capability.
- `odessa-event-ingest.json`: recebe eventos externos, normaliza para `LiveEvent` e envia ao backend Odessa.
- `odessa-session-summary.json`: busca auditoria recente do backend e gera um resumo de sessao.
- `odessa-project-creation.json`: recebe um brief, chama o backend Odessa para gerar plano estruturado, monta mensagem Slack e retorna um artefato JSON.
- `odessa-night-shift.json`: prepara avancos seguros para o projeto durante uma pausa, sem editar codigo automaticamente.
- `odessa-continuous-organizer.json`: roda a cada 30 minutos e mantem uma fila viva de tarefas priorizadas ate o produto final.
- `odessa-visual-asset-generator.json`: roda em loop e cria prompts/imagens de persona e ambientes para Odessa/Juju usando Gemini, com inspiracao visual anonima de lives sociais e sem copiar pessoas reais.

Para OBS real, instale o community node `@mashgizmo/n8n-nodes-obs-websocket`, habilite o WebSocket no OBS em `Tools -> WebSocket Server Settings` e configure uma credencial n8n para `localhost:4455`. Depois de importar `odessa-action-dispatch.json`, substitua a credencial placeholder do node `OBS WebSocket - Scene` pela sua credencial local. As operacoes usadas sao `scene/list` para whitelist automatica e `scene/setCurrent` para `obs.switch_scene`.

Os nodes de Slack/adapters reais restantes devem ser conectados dentro do n8n quando as credenciais estiverem prontas.

## Payload de criacao de projeto

Envie um `POST` para o webhook `odessa/project-create`:

```json
{
  "title": "Nome da etapa ou ideia",
  "brief": "Descricao do que queremos criar",
  "priority": "normal",
  "area": "automacao",
  "requestedBy": "Lucas",
  "constraints": ["local-first", "Slack + JSON no MVP"],
  "targetChannel": "odessa-roadmap"
}
```

O workflow chama `POST http://127.0.0.1:8000/project/create-plan` e responde com `projectPlan`, `slackMessage`, `slackDispatch` e `artifact`.
Se `N8N_SLACK_WEBHOOK_URL` estiver configurado, ele tenta publicar a mensagem; caso contrario, apenas devolve o bloco pronto para publicacao manual.

## Payload Night Shift

Envie um `POST` para o webhook `odessa/night-shift`:

```json
{
  "objective": "Preparar avancos seguros para o proximo ciclo do Odessa enquanto Lucas descansa",
  "durationMinutes": 90,
  "focusAreas": ["runtime", "automacao", "qa", "docs"],
  "maxAdvancements": 4,
  "requestedBy": "Lucas",
  "constraints": ["safe-mode", "sem edicao automatica de codigo"],
  "targetChannel": "odessa-roadmap"
}
```

O workflow chama `POST http://127.0.0.1:8000/project/night-shift` e responde com `nightShift`, `slackMessage`, `slackDispatch` e `artifact`.
Ele foi desenhado para preparar backlog, criterios, riscos e briefing de retorno; execucao de codigo continua exigindo supervisao.

## Organizacao continua

O workflow `Odessa - Continuous Project Organizer` tem dois gatilhos:

- Schedule automatico a cada 30 minutos.
- Webhook manual `POST http://localhost:5678/webhook/odessa/continuous-organizer`.

Ele chama `POST http://127.0.0.1:8000/project/continuous-organizer`, que atualiza:

- `server/runtime/project_tasks.json`: fila atual de tarefas priorizadas.
- `server/runtime/project_organizer_runs.json`: historico das rodadas de organizacao.
- `server/runtime/n8n_audit.json`: auditoria resumida do que foi organizado.

Para consultar a fila viva:

```bash
curl http://localhost:8000/project/tasks
```

Payload manual opcional:

```json
{
  "objective": "Organizar continuamente as tarefas ate o produto final",
  "focusAreas": ["runtime", "automacao", "qa", "docs"],
  "maxTasks": 8,
  "targetChannel": "odessa-roadmap"
}
```

## Gerador visual da Odessa/Juju

O workflow `Odessa - Visual Asset Generator` tem dois gatilhos:

- Schedule automatico a cada 45 minutos.
- Webhook manual `POST http://localhost:5678/webhook/odessa/visual-assets`.

Ele chama `POST http://127.0.0.1:8000/visual-lab/run`, que gera uma rodada visual em:

- `server/runtime/visual-assets/<runId>/manifest.json`
- `server/runtime/visual-assets/<runId>/*.png`
- `server/runtime/visual_asset_runs.json`

O limite padrao e conservador para evitar gasto acidental: ate 6 prompts por rodada. No schedule automatico, `generateImages` fica desligado a menos que `ODESSA_VISUAL_SCHEDULE_GENERATE_IMAGES=true` esteja no ambiente do n8n. No webhook manual, `generateImages` fica ligado por padrao e o backend limita a quantidade por `ODESSA_MAX_VISUAL_IMAGES_PER_RUN`. Quando `imageProvider` estiver em `auto`, o backend tenta Gemini primeiro e cai para OpenAI Images se `OPENAI_API_KEY` estiver configurada.

Payload manual opcional:

```json
{
  "objective": "Gerar referencias de cenario e poses para Odessa/Juju",
  "references": [
    {
      "source": "tango_live_observation",
      "notes": "Observacao anonima: lives verticais usam ring light, quarto compacto, LED colorido e gestos de agradecimento para presentes."
    }
  ],
  "maxPrompts": 6,
  "maxImages": 2,
  "generateImages": true,
  "imageProvider": "auto",
  "targetChannel": "odessa-roadmap"
}
```

Importante: este workflow nao deve copiar rosto, nome, handle, quarto identificavel, tatuagens, logos ou identidade de criadoras reais. Use observacoes do Tango Live apenas como tendencias visuais anonimas. Quando um adapter real de observacao existir, ele deve enviar apenas notas anonimizadas para o webhook.
