# Seguranca e Compliance

## Segredos

- Nao manter chaves em codigo fonte.
- Usar `.env` local para `GEMINI_API_KEY` e `OPENAI_API_KEY`.
- A chave OpenAI que estava hardcoded no backend antigo deve ser revogada/rotacionada.
- Nao commitar `.env`.

## Limites atuais

- O backend e local e exposto apenas para desenvolvimento.
- O frontend nao chama Gemini diretamente.
- Premium TTS falha com erro 503 se `OPENAI_API_KEY` nao estiver configurada.

## Proximas melhorias

- Restringir CORS por ambiente.
- Adicionar limite de tamanho para imagens enviadas ao `/ocr`.
- Registrar erros sem dados sensiveis.
- Separar perfis de persona aprovados e testes experimentais.
