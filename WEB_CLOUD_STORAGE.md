# Odessa Web Cloud Storage

Este passo prepara a Odessa para rodar no Vercel com dados persistentes:

- Neon Postgres guarda `persona_config`, workflows, triggers e configuracoes.
- Vercel Blob guarda os videos em `videos/<nome-do-arquivo>`.

## Variaveis Necessarias Na Vercel

Configure no projeto Vercel:

```text
DATABASE_URL=...
BLOB_READ_WRITE_TOKEN=...
ODESSA_ADMIN_PASSWORD=Project1m$
ODESSA_SESSION_SECRET=...
```

`DATABASE_URL` deve vir de um banco Neon Postgres conectado pelo Vercel Marketplace. `BLOB_READ_WRITE_TOKEN` deve vir de um store Vercel Blob.

## Sincronizar Config/Workflow

No ambiente local, com a mesma senha admin:

```powershell
$env:ODESSA_CLOUD_URL="https://odessa-gules.vercel.app"
$env:ODESSA_ADMIN_PASSWORD="Project1m$"
npm run cloud:sync-config
```

Isso envia `server/data/persona_config.json` para `/api/v1/video/config`, que persiste no Neon.

## Sincronizar Videos

Traga o token do Vercel Blob para o ambiente local e rode:

```powershell
$env:BLOB_READ_WRITE_TOKEN="..."
npm run cloud:sync-videos
```

Os arquivos em `assets/videos` sao enviados para o Blob com URLs publicas. A API cloud passa a devolver esses videos em `/api/v1/video/config` e redirecionar `/api/video/play/:id` para o Blob.

## Verificacao

Depois de configurar as variaveis e fazer deploy:

```powershell
npm run cloud:sync-config
npm run cloud:sync-videos
```

No app publicado, a pagina de fluxo deve carregar o workflow salvo no Neon e os videos devem tocar a partir do Blob.
