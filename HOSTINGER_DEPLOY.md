# Deploy na Hostinger

A Odessa roda na Hostinger como um Node.js Web App único:

- `npm run build` gera o frontend em `dist/`
- `hostinger-server.mjs` serve o painel e encaminha `/api/*` para os handlers em `api/`

## Domínio atual

```
https://darkgrey-shark-457698.hostingersite.com
```

## Build + deploy (via Claude Code / MCP)

```powershell
npx vite build
Compress-Archive -Path dist, api, public, src, workflows, package.json, package-lock.json, hostinger-server.mjs, vite.config.ts, tsconfig.json, .hostinger.json, index.html -DestinationPath deploy.zip -Force
```

Depois use o tool `mcp__hostinger-mcp__hosting_deployJsApplication`:
- `archivePath`: caminho absoluto do `deploy.zip`
- `domain`: `darkgrey-shark-457698.hostingersite.com`

## Variáveis de ambiente (hPanel)

Configure em **Websites → Manage → Environment Variables**:

```env
NODE_ENV=production
ODESSA_PUBLIC_URL=https://darkgrey-shark-457698.hostingersite.com
ODESSA_ADMIN_PASSWORD_HASH=8b9ddf7394e8055c164f989aac111b17e99fdedff3cc5cb4e34d4b3521f8873d
ODESSA_SESSION_SECRET=<segredo longo e aleatório>
ODESSA_COOKIE_SECURE=true
ODESSA_COOKIE_SAMESITE=Lax
```

O hash acima corresponde à senha `Odessa2026`. Prefira `ODESSA_ADMIN_PASSWORD_HASH` em vez de `ODESSA_ADMIN_PASSWORD` para evitar problemas com caracteres especiais.

## Adicionando novos endpoints de API

A Hostinger não resolve catch-all (`api/[...path].js`) para rotas sem arquivo físico correspondente. Ao criar um novo endpoint:

1. Crie um arquivo dedicado: `api/v1/meu-endpoint.js`
2. Coloque toda a lógica dentro do próprio arquivo (sem imports de código compartilhado)
3. Inclua o novo arquivo no ZIP do deploy

## KV store (produção)

A configuração da persona e o estado do vídeo ficam em:

```
~/odessa-data/data/kv.json
```

No build, o `odessaSchedulePlugin` no `vite.config.ts` tenta ler esse arquivo para injetar os agendamentos no bundle. Como o build roda em container isolado, essa injeção falha — mas a `PersonaOverlay.tsx` faz fallback e carrega `public/odessa-schedules.json` em tempo de execução.

Para atualizar os agendamentos após mudanças no workflow:
1. Configure o workflow no ReactiveFlow
2. Atualize `public/odessa-schedules.json` manualmente
3. Faça o deploy

## Reinício do processo Node.js

O processo na Hostinger **não reinicia automaticamente** após deploy estático. Mudanças na API (`api/*.js`, `hostinger-server.mjs`) só entram em vigor após reinício manual:

**hPanel → Websites → Manage → Restart**

## Validação pós-deploy

```
https://darkgrey-shark-457698.hostingersite.com/healthz
https://darkgrey-shark-457698.hostingersite.com/api/health
https://darkgrey-shark-457698.hostingersite.com/api/v1/video/state
https://darkgrey-shark-457698.hostingersite.com/#overlay
```

## OBS (Browser Source)

```
https://darkgrey-shark-457698.hostingersite.com/#overlay
```
