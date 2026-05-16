# Odessa Agent

O Odessa Agent e o processo local que conecta a maquina da live a Odessa Cloud.

Ele roda na maquina onde estao OBS, captura, OCR local, videos e automacoes locais. A Vercel fica como painel e camada cloud; o agent executa o que precisa da maquina.

## Variaveis

Configure no `.env` local:

```text
ODESSA_CLOUD_URL="https://odessa-gules.vercel.app"
ODESSA_AGENT_ID="live-machine"
ODESSA_AGENT_TOKEN="mesmo-token-configurado-na-vercel"
```

Configure na Vercel:

```powershell
"mesmo-token-configurado-na-vercel" | npx vercel env add ODESSA_AGENT_TOKEN production
```

## Rodar

```powershell
npm run dev:agent
```

Ao iniciar, o agent tambem abre uma API local em:

```text
http://127.0.0.1:8766
```

A interface hospedada na Vercel usa essa API local para comandos reais quando estiver aberta na propria maquina da live.

Endpoints locais:

- `GET /status`
- `POST /command`

Exemplo:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8766/status
```

## Endpoints Cloud

- `GET /api/agent?action=status`: painel autenticado consulta conexao do agent.
- `POST /api/agent?action=heartbeat`: agent informa presenca e saude local.
- `GET /api/agent?action=commands-next`: agent busca proximo comando.
- `POST /api/agent?action=commands`: painel enfileira comando para o agent.
- `POST /api/agent?action=events`: agent registra resultado de comando/evento.

## Comandos iniciais

- `noop`
- `obs.health`
- `obs.live_health`
- `obs.settings`

Esta primeira versao usa memoria temporaria da funcao serverless da Vercel. Para producao real multiusuario/robusta, a fila e o estado do agent devem ir para storage persistente, como Vercel KV, Postgres ou Redis.

Para comandos reais do operador, o caminho preferencial do MVP e Vercel UI -> `http://127.0.0.1:8766/command` -> OBS local. A fila cloud fica como fallback/diagnostico enquanto nao houver storage persistente.
