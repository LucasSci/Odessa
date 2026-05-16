# Deploy Odessa na Hostinger Business Web Hosting

Este caminho usa a Hostinger como um Node.js Web App gerenciado. A Odessa roda como um app Node unico:

- `npm run build` gera o frontend em `dist/`;
- `npm start` sobe `hostinger-server.mjs`;
- `hostinger-server.mjs` serve o painel e encaminha `/api/*` para o handler cloud existente.

## Configuracao no hPanel

1. Acesse `Websites`.
2. Escolha `Add Website`.
3. Selecione `Node.js Apps`.
4. Importe o repositorio pelo GitHub ou envie o ZIP do projeto.
5. Selecione Node.js `22.x` ou `24.x`.
6. Use:
   - Build command: `npm run hostinger:build`
   - Start command: `npm start`

## Variaveis de ambiente

Configure no hPanel:

```env
NODE_ENV=production
ODESSA_PUBLIC_URL=https://SEU-DOMINIO-DA-HOSTINGER
ODESSA_ADMIN_PASSWORD_HASH=8b9ddf7394e8055c164f989aac111b17e99fdedff3cc5cb4e34d4b3521f8873d
ODESSA_SESSION_SECRET=troque-por-um-segredo-longo
ODESSA_COOKIE_SECURE=true
ODESSA_COOKIE_SAMESITE=Lax
DATABASE_URL=postgresql://...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
ODESSA_AGENT_TOKEN=mesmo-token-do-agent-local
```

O hash acima corresponde a senha admin `Odessa2026`. Preferir `ODESSA_ADMIN_PASSWORD_HASH` evita problemas com caracteres especiais em paineis ou scripts de deploy.

Se quiser manter Neon e Vercel Blob, use os mesmos valores atuais de `DATABASE_URL` e `BLOB_READ_WRITE_TOKEN`.

## Agent local

No computador da live, aponte o Odessa Agent para a Hostinger:

```env
ODESSA_CLOUD_URL=https://SEU-DOMINIO-DA-HOSTINGER
ODESSA_AGENT_TOKEN=mesmo-token-configurado-na-hostinger
```

Depois reinicie o agent local.

## Validacao

Depois do deploy:

```text
https://SEU-DOMINIO-DA-HOSTINGER/healthz
https://SEU-DOMINIO-DA-HOSTINGER/api/health
https://SEU-DOMINIO-DA-HOSTINGER/api/v1/video/state
https://SEU-DOMINIO-DA-HOSTINGER/#overlay
```

No OBS, a fonte `Odessa Stage Overlay` deve apontar para:

```text
https://SEU-DOMINIO-DA-HOSTINGER/#overlay
```

## Observacoes

- A Hostinger Business Web Hosting nao substitui o computador da live. O OBS ainda precisa do Odessa Agent local para comandos de cena, captura e OCR.
- O Vercel pode continuar como fallback ate a Hostinger estar validada.
- Nao suba `.env`, `.env.local` ou arquivos com senhas para o repositorio.
