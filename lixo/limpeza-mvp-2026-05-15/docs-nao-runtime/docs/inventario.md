# Inventario do Projeto

## Nucleo mantido

- `src/App.tsx`: navegacao principal e estado compartilhado de eventos capturados.
- `src/CaptureStudio.tsx`: fluxo de captura, zonas OCR, eventos e rota para a Persona.
- `src/AIPersonaTrainer.tsx`: configuracao de persona, teste manual, respostas ao vivo e TTS.
- `src/LiveAutopilotConsole.tsx`: console de Autopilot auditado, eventos de teste, timeline e acoes simuladas.
- `src/types.ts`: tipos compartilhados para eventos da live, decisoes e acoes.
- `src/lib/api.ts`: URL base da API local via `VITE_API_BASE_URL`.
- `server/main.py`: backend local FastAPI para OCR, decisoes IA, respostas simples e TTS.
- `server/requirements.txt`: dependencias Python do backend.
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `metadata.json`.

## Arquivado

O material fora do foco atual foi movido para `archive/legacy-2026-04-29/`, incluindo:

- Workspace conceitual amplo.
- READMEs antigos de automacao/OCR.
- ZIP exportado antigo.
- Backup antigo de `App.tsx`.
- Scripts isolados de Tango, OCR, selecao de regioes e testes.
- Log de captura antigo.

## Gerado em runtime

- `server/runtime/captura_chat.txt`
- `server/runtime/regions.json`
- `dist/`, `node_modules/`, `venv/`, `__pycache__/`

Esses arquivos/pastas sao recriaveis e ficam ignorados.
