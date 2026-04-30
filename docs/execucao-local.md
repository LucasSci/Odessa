# Execucao Local

## Ambiente

- Node.js para o frontend.
- Python 3 para o backend.
- `.env` na raiz do projeto.

## Variaveis

- `GEMINI_API_KEY`: obrigatoria para respostas da persona IA.
- `OPENAI_API_KEY`: opcional, necessaria apenas para vozes premium OpenAI.
- `VITE_API_BASE_URL`: opcional, padrao `http://localhost:8000`.
- `APP_URL`: opcional.

## Backend

```bash
pip install -r server/requirements.txt
npm run dev:api
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

## Fluxo de uso

1. Abra o backend.
2. Abra o frontend.
3. Na aba Extrator OCR, selecione uma tela ou janela.
4. Desenhe a zona de captura sobre o chat.
5. Inicie a captura.
6. Na aba Persona IA, teste manualmente ou ative reacoes ao vivo.
7. Na aba Controle Live, inicie o Autopilot auditado e injete eventos de teste para validar decisoes e acoes.
