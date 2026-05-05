# Odessa Project

Aplicacao React/Vite para capturar texto de lives via OCR, gerar reacoes de persona IA, auditar um fluxo de Autopilot e opcionalmente falar essas respostas por TTS.

O foco atual do projeto e a aplicacao React existente com um backend local Python de suporte para OCR, IA e TTS.

## Estrutura principal

- `src/`: aplicacao React/Vite.
- `server/`: API local FastAPI usada pelo frontend.
- `workflows/n8n/`: workflows exportaveis para automacoes externas.
- `docs/`: documentacao enxuta do produto atual.
- `archive/legacy-2026-04-29/`: material legado, POCs e planejamento amplo preservados fora do fluxo principal.

## Rodar localmente

1. Instale as dependencias JS:

   ```bash
   npm install
   ```

2. Instale as dependencias Python:

   ```bash
   pip install -r server/requirements.txt
   ```

3. Configure `.env` a partir de `.env.example`.

4. Suba o backend:

   ```bash
   npm run dev:api
   ```

5. Suba o frontend:

   ```bash
   npm run dev
   ```

6. Opcional: suba o n8n para automacoes externas:
   ```bash
   npm run dev:n8n
   ```
   Depois importe os workflows em `workflows/n8n/` no editor em `http://localhost:5678`.

## Comandos

- `npm run dev`: frontend em `http://localhost:3000`.
- `npm run dev:api`: backend em `http://localhost:8000`.
- `npm run dev:n8n`: n8n local em `http://localhost:5678`.
- `npm run lint`: TypeScript sem emissao.
- `npm run format`: formata código TypeScript.
- `npm run build`: build de producao.
- `npm run clean`: remove `dist`.
- `npm run test`: testes Vitest (frontend).
- `npm run test:watch`: testes em modo watch.
- `npm run test:coverage`: coverage frontend.

## Testing

### Backend (Python/Pytest)

```bash
# Rodar todos os testes
venv\Scripts\python.exe -m pytest tests/ -v

# Rodar com coverage
venv\Scripts\python.exe -m pytest tests/ --cov=server --cov-report=html

# Rodar testes específicos
venv\Scripts\python.exe -m pytest tests/test_health.py -v
```

**Testes disponíveis:**

- `test_health.py`: Validação do endpoint `/health`
- `test_ocr.py`: Testes do endpoint `/ocr` e processamento OCR
- `test_ai.py`: Testes dos endpoints `/ai/respond` e `/ai/decide`
- `test_tts.py`: Testes dos endpoints `/tts` e síntese de voz

**Coverage atual:** 64% (15+ testes passando)

### Frontend (TypeScript/Vitest)

```bash
# Rodar todos os testes
npm run test

# Modo watch para desenvolvimento
npm run test:watch

# Com coverage
npm run test:coverage
```

**Testes criados:**

- `src/core/eventClassifier.test.ts` - Classificação de eventos
- `src/core/personaRuntime.test.ts` - Runtime de persona
- `src/core/actionExecutor.test.ts` - Executor de ações
- `src/core/toolRegistry.test.ts` - Registry de tools
- `src/core/longTermMemory.test.ts` - Memória de longo prazo
- `src/core/moodEngine.test.ts` - Motor de mood
- `src/core/automationRules.test.ts` - Regras de automação
- `src/core/contentLibrary.test.ts` - Biblioteca de conteúdo

Relatório de coverage HTML gerado em `htmlcov/` (backend) e após `npm run test:coverage` (frontend).

Veja [TESTING.md](TESTING.md) para guia detalhado sobre escrita e manutenção de testes.

## Areas do app

- `Extrator OCR`: captura tela/janela, recorta zonas e envia eventos para a live.
- `Persona IA`: configura a streamer, testa respostas e voz.
- `Controle Live`: console de Autopilot auditado para testar decisoes, acoes simuladas e TTS real.

## Documentacao

- [Visao do produto](docs/visao-produto.md)
- [Inventario do projeto](docs/inventario.md)
- [Plano MVP](docs/plano-mvp.md)
- [Execucao local](docs/execucao-local.md)
- [Seguranca e compliance](docs/seguranca-compliance.md)
