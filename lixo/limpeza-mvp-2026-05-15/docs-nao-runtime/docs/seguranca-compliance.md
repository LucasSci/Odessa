# Seguranca e Compliance

## Segredos

- Nao manter chaves em codigo fonte.
- Usar `.env` local para `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_TTS_MODEL` e webhooks n8n.
- Manter `N8N_WEBHOOK_SECRET` apenas no backend/local e validar o mesmo segredo no n8n pelo header `X-Odessa-Secret`.
- A chave OpenAI que estava hardcoded no backend antigo deve ser revogada/rotacionada.
- Nao commitar `.env`.

## Limites atuais

- O backend e local e exposto apenas para desenvolvimento.
- O frontend nao chama Gemini nem OpenAI diretamente; o backend escolhe Gemini como primario e OpenAI como fallback.
- O frontend nao conhece URLs secretas de webhook n8n; despacho de acoes e auditoria passa pelo backend.
- Premium TTS falha com erro 503 se `OPENAI_API_KEY` nao estiver configurada.

## Proximas melhorias

- Restringir CORS por ambiente.
- Adicionar allowlist de origem/IP para webhooks n8n em ambiente fora do localhost.
- Registrar erros sem dados sensiveis.
- Separar perfis de persona aprovados e testes experimentais.
