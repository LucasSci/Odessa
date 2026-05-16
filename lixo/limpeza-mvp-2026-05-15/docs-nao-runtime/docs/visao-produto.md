# Visao do Produto

Odessa e um assistente operacional para lives: ele captura regioes da tela, extrai texto por OCR, registra eventos, usa uma persona IA para decidir respostas e permite auditar o ciclo de Autopilot da transmissao.

## Produto atual

- Frontend React/Vite com tres areas principais: Extrator OCR, Persona IA e Controle Live.
- Backend local FastAPI para OCR, respostas de IA e TTS.
- Operacao local em `localhost`, voltada para validacao rapida com OBS ou uma janela de live.

## Objetivo imediato

Transformar o prototipo existente em uma base estavel e organizada para iterar no fluxo:

1. Selecionar tela ou janela.
2. Marcar zonas de captura.
3. Extrair texto com OCR.
4. Enviar mensagens novas para a persona IA.
5. Gerar decisao estruturada da Persona.
6. Auditar acoes da live, com TTS real e comandos externos simulados.

## Fora do foco atual

- Automacao direta real de chat, OBS e plataformas externas.
- Arquitetura cloud, pagamentos, banco de dados e avatar animado.
- Workspace amplo de produto antigo, preservado apenas no arquivo legado.
