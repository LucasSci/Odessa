# Odessa

Aplicacao React/Vite para capturar texto de lives via OCR, gerar reacoes de persona IA, auditar um fluxo de Autopilot e opcionalmente falar essas respostas por TTS.

O foco atual do projeto e a aplicacao React existente com um backend local Python de suporte para OCR, IA e TTS.

## Estrutura principal

- `src/`: aplicacao React/Vite.
- `server/`: API local FastAPI usada pelo frontend.
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

## Comandos

- `npm run dev`: frontend em `http://localhost:3000`.
- `npm run dev:api`: backend em `http://localhost:8000`.
- `npm run lint`: TypeScript sem emissao.
- `npm run build`: build de producao.
- `npm run clean`: remove `dist`.

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
