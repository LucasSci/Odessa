# OBS + Bridge do Tango

## Configuração do OBS

1. Adicione uma **Browser Source** na cena da live
2. URL: `http://localhost:3000/#overlay` (dev) ou `https://SEU-DOMINIO.hostingersite.com/#overlay` (produção)
3. Resolução: `1920×1080` (ou a resolução da cena)
4. Marque **"Refresh browser when scene becomes active"**

### OBS WebSocket

Habilite o OBS WebSocket em **Tools → WebSocket Server Settings** (porta 4455).
A Browser Source "Odessa Chat OCR" deve permanecer ativa (não feche quando ocultar).

### Iniciar live automaticamente

O botão **Iniciar live** executa uma sequência única e aguardada:

1. valida e reconecta ao OBS WebSocket;
2. cria ou atualiza as cenas `Odessa START` e `Odessa LIVE`;
3. cria ou corrige as Browser Sources do palco e do chat;
4. ajusta o canvas vertical e os transforms das fontes;
5. atualiza as fontes sem cache e troca para `Odessa LIVE`;
6. inicia o stream ou a câmera virtual conforme `transmissionMode`;
7. confirma o estado final antes de considerar a live iniciada.

Se o OBS estiver fechado, o botão não inicia parcialmente o runtime: mostra o
erro de conexão e pausa a automação. Depois de abrir o OBS e habilitar o
WebSocket, basta clicar novamente. A configuração é idempotente e pode ser
executada em mais de uma live sem duplicar cenas ou fontes.

O endpoint equivalente para diagnóstico é `POST /api/v1/obs/start-live` com
`actionMode: "real"`. O endpoint retorna `ok: false` quando não consegue
conectar ou confirmar a transmissão.

## Bridge do Tango

A bridge é um subprocesso headless Chromium (Playwright) que captura o chat ao
vivo e transmite a tela via CDP. Ela expõe um servidor aiohttp na porta 7555.

### Auto-início

A bridge **inicia automaticamente** quando o backend sobe (controlado por
`ODESSA_AUTOSTART_BRIDGE`, default `1`). Desative com `ODESSA_AUTOSTART_BRIDGE=0`
em ambientes sem Chromium/desktop (ex.: nuvem).

### Configuração

A config fica em `server/runtime/bridge_config.json`:

```json
{
  "mode": "standalone",
  "cdpUrl": "http://127.0.0.1:9222",
  "roomUrl": "https://tango.me/stream/broadcast",
  "port": 7555,
  "autoconnect": true,
  "selectors": {
    "containerChat": "[data-testid=\"virtuoso-item-list\"]",
    "mensagem": "[data-testid^=\"chat-event-\"]",
    "username": ".Hhi6n",
    "textoMsg": ".KR99L",
    "inputTexto": "[data-testid=\"textarea\"]",
    "botaoEnviar": ""
  }
}
```

> **Importante:** `roomUrl` deve apontar para o Tango (não para sites de teste).
> Os seletores dependem do DOM atual do Tango e podem precisar de ajuste se o
> Tango mudar o layout.

### Gerenciamento via API

- `GET /api/v1/chat-automation/bridge/status` — status do processo e conectividade
- `POST /api/v1/chat-automation/bridge/start` — inicia a bridge
- `POST /api/v1/chat-automation/bridge/stop` — para a bridge
- `GET /api/v1/chat-automation/bridge/logs` — logs da bridge

### Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| `processRunning: false` | Bridge não iniciou | Inicie via API ou reinicie o backend |
| `bridgeReachable: false` | Processo morto/órfão | Pare processos órfãos e reinicie |
| `status: disconnected` | Não conectou ao Tango | Verifique `roomUrl` e o login no perfil do Chromium |
| `messageCount: 0` | Seletores desatualizados | Atualize os seletores no `bridge_config.json` |
| Screenshot vazio | Página não carregou | Verifique o login e a URL de broadcast |

## Transmissão estável (quadros perdidos)

Para resolver "quadros perdidos (rede)" no OBS:

1. **Chave/servidor do Tango:** sempre comece a live com um perfil recém-baixado
   do Tango (a chave costuma expirar por sessão).
2. **Bitrate dinâmico:** ligue "Mudar o bitrate dinamicamente" (Configurações →
   Avançado → Rede).
3. **Encoder:** use hardware (NVENC/QuickSync), CBR, keyframe 2s, bitrate ~3000.
4. **Vídeo:** saída 720×1280 @ 30, Lanczos.
5. **Rede:** use cabo Ethernet, bitrate ≤ ~70% do upload, **pause o OneDrive**
   durante a live (o projeto fica numa pasta do OneDrive e a sincronização come
   o upload).
