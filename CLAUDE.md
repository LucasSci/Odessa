# Odessa — instructions for Claude Code

## Branch policy: work directly on `main`

This project is also edited via **Codex** (which pushes to `main` directly).
To keep both agents in sync, Claude Code should also work on `main` — **not** in worktrees or feature branches.

**Every session:**

1. At the start: `git checkout main && git pull --ff-only`
2. Make changes and commit on `main`
3. After every commit: `git push`

Do **not** create worktrees. Do **not** create feature branches unless the user explicitly asks. If the harness opens a worktree by default, `cd` back to the main repo (`C:\Users\Lucas\Desktop\Odessa`) and operate there.

## Deploy

Deploys go to Hostinger at `darkgrey-shark-457698.hostingersite.com`.

Build + zip + deploy:

```powershell
npx vite build
Compress-Archive -Path dist, api, public, src, workflows, package.json, package-lock.json, hostinger-server.mjs, vite.config.ts, tsconfig.json, .hostinger.json, index.html -DestinationPath deploy.zip -Force
```

Then call `mcp__hostinger-mcp__hosting_deployJsApplication` with `archivePath` pointing at `deploy.zip` and `domain` = `darkgrey-shark-457698.hostingersite.com`.

## API routing gotcha

Hostinger only invokes API handlers that exist as physical files in `api/`.
The catch-all `api/[...path].js` is **not** picked up for routes that don't have a matching file (e.g. `/api/v1/workflow/profiles` needs `api/v1/workflow/profiles.js`).

When adding a new endpoint, **always create a dedicated file** with the handler logic self-contained (no shared imports from app code — Vercel-style serverless functions don't reliably resolve those on Hostinger).

## Auth (for testing endpoints)

Default admin login: `lucasbatista.c.l@gmail.com` / `12345678`.
Session token comes back as `sessionToken` in the login response and goes in the `Authorization: Bearer <token>` header.
