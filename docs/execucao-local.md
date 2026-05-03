# Execucao Local

## Ambiente

- Node.js para o frontend.
- Python 3 para o backend.
- `.env` na raiz do projeto.

## Variaveis

- `GEMINI_API_KEY`: provider primario para respostas e decisoes da Persona.
- `OPENAI_API_KEY`: fallback de IA quando Gemini cair e tambem vozes premium OpenAI.
- `OPENAI_TEXT_MODEL`: modelo OpenAI de texto usado no fallback, padrao `gpt-4o-mini`.
- `OPENAI_TTS_MODEL`: modelo OpenAI de voz, padrao `tts-1`.
- `TTS_DEFAULT_PROVIDER`: provider padrao de voz, padrao `edge`.
- `KOKORO_ENABLED`: habilita Kokoro no backend, padrao `true`.
- `KOKORO_DEFAULT_LANG`: codigo de idioma Kokoro, padrao `p` para PT-BR.
- `KOKORO_DEFAULT_VOICE`: voz Kokoro padrao, padrao `pf_dora`.
- `KOKORO_DEFAULT_SPEED`: velocidade Kokoro padrao, padrao `1.0`.
- `ESPEAK_NG_PATH`: opcional quando o `espeak-ng` foi instalado mas nao entrou no `PATH`.
- `OPENAI_IMAGE_MODEL`: modelo OpenAI usado como fallback de imagem, padrao `gpt-image-1`.
- `OPENAI_IMAGE_SIZE`: tamanho opcional para imagens OpenAI; vazio usa mapeamento por aspect ratio.
- `OPENAI_IMAGE_QUALITY`: qualidade de imagem OpenAI, padrao `auto`.
- `VITE_API_BASE_URL`: opcional, padrao `http://localhost:8000`.
- `APP_URL`: opcional.
- `N8N_BASE_URL`: URL local do n8n, padrao `http://localhost:5678`.
- `N8N_WEBHOOK_SECRET`: segredo enviado no header `X-Odessa-Secret`.
- `N8N_AUDIT_WEBHOOK_URL`: webhook n8n para ciclos, decisoes e erros.
- `N8N_ACTION_WEBHOOK_URL`: webhook n8n para despacho de acoes externas.
- `N8N_EVENT_INGEST_WEBHOOK_URL`: webhook n8n para entrada externa de eventos.
- `N8N_PROJECT_CREATION_WEBHOOK_URL`: webhook n8n para criacao de planos de projeto.
- `N8N_NIGHT_SHIFT_WEBHOOK_URL`: webhook n8n para preparar avancos seguros durante pausas.
- `N8N_VISUAL_ASSET_WEBHOOK_URL`: webhook n8n para gerar prompts e imagens da Odessa/Juju.
- `N8N_SLACK_WEBHOOK_URL`: webhook Slack opcional usado pelo processo n8n para publicar planos.
- `ODESSA_PROJECT_OUTPUT_DIR`: pasta local sugerida para artefatos JSON exportados.
- `ODESSA_VISUAL_OUTPUT_DIR`: pasta local para manifestos e imagens do Visual Lab.
- `ODESSA_MAX_VISUAL_IMAGES_PER_RUN`: limite de imagens por rodada para controlar custo.
- `ODESSA_VISUAL_SCHEDULE_GENERATE_IMAGES`: quando `true`, o schedule do n8n tambem tenta gerar imagens; por padrao fica `false` para evitar gasto/erro em loop.
- `ODESSA_VISUAL_IMAGE_PROVIDER`: `auto`, `gemini` ou `openai`; em `auto`, tenta Gemini e cai para OpenAI.
- `GEMINI_IMAGE_MODEL`: modelo Gemini usado para geracao de imagens.

## Backend

```bash
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install -r server\requirements.txt
npm run dev:api
```

### Kokoro TTS no Windows

O Kokoro precisa de Python 3.10 a 3.13. Use Python 3.12 no `venv` principal do Odessa.

Para voz PT-BR, instale tambem o `espeak-ng`:

```powershell
winget install --id eSpeak-NG.eSpeak-NG -e
```

Se o `winget` nao encontrar o pacote, instale pelo MSI oficial do eSpeak NG e reabra o terminal para atualizar o `PATH`.

Depois de subir o backend, valide:

```bash
curl http://localhost:8000/tts/voices
```

Health check:

```bash
curl http://localhost:8000/health
```

## Frontend

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## n8n opcional

```bash
npm run dev:n8n
```

Acesse `http://localhost:5678`, importe os workflows de `workflows/n8n/` e copie as URLs de webhook para o `.env`.
O backend envia webhooks com `X-Odessa-Secret`; mantenha o mesmo valor no n8n e no `.env` local.
Se trocar o segredo padrao, ajuste tambem o header do workflow `Odessa - Event Ingest` ou exponha `N8N_WEBHOOK_SECRET` no ambiente em que o n8n foi iniciado.
Para criar planos de projeto, importe `Odessa - Project Creation Pipeline` e envie o brief para o webhook `odessa/project-create`.
Para preparar avancos durante uma pausa, importe `Odessa - Night Shift Safe Advances` e envie o objetivo para o webhook `odessa/night-shift`.
Para gerar referencias visuais, importe `Odessa - Visual Asset Generator` e envie observacoes anonimizadas para o webhook `odessa/visual-assets`, ou deixe o schedule rodar a cada 45 minutos.
Se quiser publicacao automatica no Slack, inicie o n8n com `N8N_SLACK_WEBHOOK_URL` configurado no ambiente.

### Visual Lab

O Visual Lab salva cada rodada em `server/runtime/visual-assets/<runId>/`, com `manifest.json` e imagens geradas pelo Gemini ou pela OpenAI quando as chaves estiverem configuradas. Em `ODESSA_VISUAL_IMAGE_PROVIDER=auto`, o backend tenta Gemini primeiro e usa OpenAI como fallback se o Gemini cair por cota ou erro. Use referencias do Tango Live apenas como tendencias anonimas de luz, enquadramento, ambiente, energia e interacao; nao use rosto, nome, handle, quarto identificavel, logos ou identidade de pessoas reais.

## Fluxo de uso

1. Abra o backend.
2. Abra o frontend.
3. Na aba Extrator OCR, selecione uma tela ou janela.
4. Desenhe a zona de captura sobre o chat.
5. Inicie a captura.
6. Na aba Persona IA, ajuste personalidade, memoria e teste manual isolado.
7. Na aba Controle Live, inicie o Autopilot auditado e injete eventos de teste para validar decisoes e acoes.
8. Opcionalmente, conecte o n8n para receber auditoria, despachar acoes externas simuladas e enviar eventos de volta ao Event Bus.
