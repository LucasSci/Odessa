# Plano MVP

## Objetivo

Entregar uma aplicacao local confiavel para apoiar uma live assistida por IA, com captura OCR, resposta textual e voz opcional.

## Funcionalidades prioritarias

- Captura de monitor ou janela.
- Selecao visual de ate quatro zonas OCR.
- Ajustes de contraste, brilho, zoom e intervalo.
- Envio de imagem processada para o backend `/ocr`.
- Registro das mensagens novas no painel.
- Persona editavel no frontend.
- Endpoint backend `/ai/respond` para gerar resposta sem expor chaves no bundle, com Gemini primario e OpenAI fallback.
- Endpoint backend `/ai/decide` para gerar decisao estruturada do Autopilot, com Gemini primario e OpenAI fallback.
- Endpoint backend `/tts` para voz premium OpenAI ou vozes Edge/Azure.
- Controle Live com timeline auditavel, fila de acoes, eventos de teste e comandos externos simulados.

## Criterios de aceite

- `npm run lint` passa.
- Backend responde `GET /health`.
- OCR aceita imagem base64 em `POST /ocr`.
- Persona manual gera resposta via backend quando `GEMINI_API_KEY` ou `OPENAI_API_KEY` esta configurada.
- Controle Live gera decisoes com `speak` real e acoes externas simuladas.
- Premium TTS so funciona quando `OPENAI_API_KEY` esta configurada.
- Nenhuma chave de API fica hardcoded no codigo.
