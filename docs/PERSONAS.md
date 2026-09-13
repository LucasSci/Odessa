# Perfis de persona e conversa com IA

## O que é uma persona

Uma persona é um perfil de IA selecionável, cada um com seus próprios vídeos,
fluxo, gatilhos e personalidade. O Odessa suporta múltiplas personas, e a ativa
determina qual config o backend carrega.

## Personas padrão

| Persona | Personalidade |
|---|---|
| **Odessa** (padrão) | Cativante, carinhosa, bem-humorada, calorosa |
| **Viktoria** | Elegante, misteriosa, sofisticada, tom charmoso |
| **Barbara** | Extrovertida, animada, próxima do público, divertida |

## Como funcionam

- O índice `server/data/personas.json` lista as personas e qual é a ativa.
- Cada persona tem um arquivo de config próprio (`persona_<id>.json`) com
  vídeos, fluxo e gatilhos.
- A persona padrão "odessa" aponta para o config legado `persona_config.json`
  (não quebra nada na primeira execução).
- A **personalidade** (prompt de sistema) de cada persona é armazenada no
  índice e aplicada como prompt da IA quando a persona está ativa.

## Gerenciar personas

### Via UI

Na aba **Diretora IA** do painel, o seletor de personas permite:
- Listar e selecionar a persona ativa
- Criar uma nova persona (nome + descrição)
- Editar a personalidade da persona ativa (textarea + "Salvar personalidade")
- Excluir personas (exceto a padrão "odessa")

### Laboratório de conversa

A aba **Conversa com Personas** do `OdessaLiveCenter` permite testar uma
persona antes de colocá-la em uma live. O laboratório:

- carrega a lista de personas do backend;
- mantém o histórico separado para cada persona durante a sessão do navegador;
- usa a personalidade configurada para gerar respostas curtas e contextualizadas;
- não inicia a bridge do Tango, o OBS, a captura OCR nem o envio de mensagens reais.

O laboratório usa a IA local configurada no navegador (por padrão, Ollama em
`http://127.0.0.1:11434`, modelo `llama3.1:8b`). A configuração fica no
`localStorage` do navegador e pode ser ajustada no painel de IA. Se o provedor
local não responder, o motor aplica as respostas de fallback configuradas para
manter o teste disponível.

### Via API

```bash
# Listar
GET /api/v1/personas

# Criar
POST /api/v1/personas
{"name":"Nova","description":"...","personality":"..."}

# Definir ativa
POST /api/v1/personas/active
{"id":"nova"}

# Definir personalidade
PUT /api/v1/personas/nova/personality
{"personality":"Você é a Nova..."}
```

## Conversa automática com IA

O chat do Tango responde automaticamente usando IA generativa (RouteLLM da
Abacus.AI, compatível com OpenAI). O fluxo:

1. A bridge captura a mensagem do chat (SSE `/messages`).
2. O frontend roteia a mensagem para o trigger engine (`/api/automation/ingest`)
   — palavra-chave/presente → troca de vídeo.
3. Em modo autônomo, o frontend gera uma resposta via `/api/ai/respond` usando
   a personalidade da persona ativa.
4. A resposta é enviada de volta ao chat pela bridge (`/send`).

O laboratório de conversa usa o mesmo contrato de geração, mas permanece
isolado do fluxo ao vivo: ele chama a API de resposta e exibe o resultado
somente no painel.

### Governança anti-flood

Para respostas naturais e sem flood, o `chatConversationGovernor` aplica:
- **Cooldown global** entre respostas (`chatReplyCooldownMs`, default 15s).
- **Limite por minuto** (`chatReplyMaxPerMinute`, default 4) com janela deslizante.
- **Cooldown por usuário** (20s) — evita responder a mesma pessoa em sequência.
- **Anti-flood** — ignora mensagens muito curtas e repetidas em sequência.

### Provedores de IA

O backend usa a RouteLLM da Abacus.AI por padrão (`OPENAI_BASE_URL`), com
fallback para Gemini e para respostas prontas locais. Configure no `.env`:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=<chave da RouteLLM>
OPENAI_BASE_URL=https://routellm.abacus.ai/v1
OPENAI_TEXT_MODEL=route-llm
```

Para usar a OpenAI oficial, troque `OPENAI_BASE_URL` para
`https://api.openai.com/v1` e `OPENAI_TEXT_MODEL` para um modelo OpenAI.

Para verificar o provedor selecionado e a disponibilidade do Ollama:

```bash
curl http://localhost:8000/api/v1/ai/status
```

## Geração de vídeo por persona

Cada persona tem seu próprio pipeline de geração de vídeo em tempo real,
isolado em `server/runtime/video-gen/{persona_id}/` (prompts, frames, vídeos,
fila e histórico). As interações do chat alimentam um buffer de prompts; ao
atingir o limiar, um prompt é gerado via RouteLLM e um vídeo é criado a partir
do último frame da live. O vídeo gerado é registrado no fluxo da persona ativa
(`config["videos"]` com `group="generated"`, um `flowNode` e uma
`flowConnection` a partir do nó idle). Detalhes em [`VIDEO-GEN.md`](VIDEO-GEN.md).
