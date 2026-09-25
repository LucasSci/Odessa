# Odessa — instructions for Codex

## Base44 dev environment

The Base44 sandbox runs the app via `docker-compose.base44.yml` (two services):
- **web** — Node 22 + Vite dev server on port 3000, bind-mounted source, live reload.
- **api** — Python 3.12 + uvicorn on port 8000 (internal), bind-mounted source, `--reload`.
- A one-shot **api-setup** service creates a venv (named volume `pyenv`) and installs `server/requirements-container.txt` (trimmed — excludes `pyautogui`, `easyocr`, `kokoro`, `soundfile` which need system libs or are heavy; all are lazy-loaded with fallbacks).

The Vite proxy target is configurable via `VITE_API_PROXY_TARGET` (defaults to `http://127.0.0.1:8000` for local dev; set to `http://api:8000` in compose). `allowedHosts: true` is set so the preview's external hostname is accepted.

The app boots in **simulation mode** (`SIMULATION_MODE` defaults to `true` in `server/config.py`; `ENABLE_LOCAL_FALLBACK` defaults to `false` so AI failures surface as HTTP 503 instead of a canned reply) with no external secrets. Auth is disabled (`auth-disabled-2026-05-16` — login always succeeds). AI keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are optional. Compose intentionally relies on these code defaults rather than an ignored local env file.

Verify: `curl -sf http://localhost:3000/` (frontend) and `curl -sf http://localhost:3000/api/health` (backend through the Vite proxy).

## Tango chat/live bridge (headless Chromium)

The bridge (`tango_chat/tango_chat.py`) drives a browser to capture the live
chat (MutationObserver) and stream the live screen (CDP Screencast over the
`/tango-bridge/live` WebSocket). It runs as a subprocess of the API, managed by
`server/services/bridge_manager.py`, and listens on port 7555 inside the `api`
container.

- **Playwright + Chromium** are installed in the container: the `api`/`api-setup`
  services build from `Dockerfile.base44-api` (python:3.12-slim + Chromium OS
  libs). `api-setup` also runs `playwright install chromium` into the shared
  `playwright-cache` volume so the browser binary persists across restarts.
- **Headless auto-detection**: `tango_chat.py` runs Chromium headless when there
  is no display (`TANGO_HEADLESS=true` is set in compose for the container). On a
  user's desktop (Windows/Mac) it keeps a visible window. Override with the
  `TANGO_HEADLESS` env var.
- **Proxy routing**: the Vite `/tango-bridge` proxy target is configurable via
  `VITE_BRIDGE_PROXY_TARGET` (defaults to `http://127.0.0.1:7555` for local dev;
  set to `http://api:7555` in compose since the bridge runs inside the `api`
  container, not on the web container's localhost).
- The Tango login session persists in the `tango-profile` volume. The first time
  the page needs login, use the interactive LiveVisionMonitor (click/type on the
  screencast) to log in; subsequent restarts reuse the session.
- Chat rows are virtualized: the observer must accept text changes on reused DOM
  nodes and reinject after login/navigation. Posting bridge selector config now
  reapplies the observer immediately, without requiring a process restart.

To verify the bridge end-to-end:
`curl -sf http://localhost:3000/api/v1/chat-automation/bridge/status` →
`bridgeStatus.status` should be `connected` with `observerInjected: true`.
`curl -sf http://localhost:3000/tango-bridge/screenshot -o /tmp/live.jpg` →
returns a JPEG of the live page.

## Workflow: Issue → Pull Request → merge → deploy

> **Read `docs/ENGINEERING-STANDARDS.md` before implementing anything** — it is
> the single source of truth for every agent (Codex, Claude Code or any other
> model): Issues, Pull Requests, quality pipeline, tests, observability,
> security, architecture and UI/motion rules.

1. **Every task starts as a GitHub Issue** classified as **Correção** (`correcao`),
   **Melhoria** (`melhoria`) or **Nova função** (`nova-funcao`), using the templates
   in `.github/ISSUE_TEMPLATE`. Search for duplicates first.
2. **Work on a branch — never commit or push directly to `main`.**
3. **Open a Pull Request** to `main` using `.github/PULL_REQUEST_TEMPLATE.md`. Every PR must
   mention the related Issue (`Closes #N`), explain what changed, describe how it was
   validated, and record risks, limitations and next steps.
4. Commits follow Conventional Commits with the description in Portuguese (Commitlint on CI).
5. **Merge only with the pipeline green.** Before pushing run `pnpm check`,
   `pnpm build && pnpm budget`, `pnpm test:e2e` (UI changes) and
   `PYTHONPATH=. pytest server/tests tests` (backend changes).
6. **Deploy only from `main`, after the PR is merged.**

UI work follows the Design Motion Principles skill in
`.claude/skills/design-motion-principles` (skeletons, lazy loading, enter/exit
motion, progress and feedback states, motion tokens) and reuses the existing
components listed in `docs/ENGINEERING-STANDARDS.md` §6.

## Deploy

Deploys go to Hostinger at `darkgrey-shark-457698.hostingersite.com`.

Build + zip + deploy:

```powershell
npx vite build
Compress-Archive -Path dist, api, public, src, workflows, package.json, package-lock.json, hostinger-server.mjs, vite.config.ts, tsconfig.json, .hostinger.json, index.html -DestinationPath deploy.zip -Force
```

Then call `mcp__hostinger-mcp__hosting_deployJsApplication` with `archivePath` pointing at `deploy.zip` and `domain` = `darkgrey-shark-457698.hostingersite.com`.

Deploy only from `main` after the PR is merged.

## Cloud-mode API URL alignment (Base44 preview)

The frontend `src/lib/api.ts` runs in **cloud/same-origin mode** whenever the
hostname is not localhost (i.e. the Base44 preview, and the Hostinger deploy).
In that mode it rewrites `/auth/*` → `/api/auth/*` and `/health` → `/api/health`
to match the Hostinger `api/auth/*.js` / `api/health` layout.

The FastAPI dev backend must therefore serve these under `/api` too, or login
breaks: `POST /api/auth/login` would otherwise hit the GET-only SPA catch-all
(`@app.get("/{full_path:path}")`) and return **405**, leaving the app stuck on
the login screen. `server/main.py` mounts `auth.router` at both `/auth` and
`/api/auth`, and registers `health_check` at both `/health` and `/api/health`.

## Agent relay endpoint (/api/agent)

In cloud/same-origin mode the frontend (`src/lib/api.ts`) rewrites `/obs/*` calls
to `/api/agent?obsAction=...` and `/agent/status` to `/api/agent/status`. The
Hostinger catch-all `api/[...path].js` handles this by rewriting back to
`/obs/{obsAction}`. The FastAPI dev backend mirrors this in
`server/api/v1/endpoints/agent.py` (mounted at `/api` in `main.py`), which
delegates to the OBS router and returns a local-agent status. Without it, the
preview gets **404** on every OBS-related call.

## API routing gotcha

Hostinger only invokes API handlers that exist as physical files in `api/`.
The catch-all `api/[...path].js` is **not** picked up for routes that don't have a matching file (e.g. `/api/v1/workflow/profiles` needs `api/v1/workflow/profiles.js`).

When adding a new endpoint, **always create a dedicated file** with the handler logic self-contained (no shared imports from app code — Vercel-style serverless functions don't reliably resolve those on Hostinger). ESLint enforces this (`no-restricted-imports` for `api/**/*.js`).

## Auth (for testing endpoints)

Use the admin email and password configured in the server's environment variables (`ODESSA_ADMIN_PASSWORD` / `ODESSA_ADMIN_PASSWORD_HASH`).
Session token comes back as `sessionToken` in the login response and goes in the `Authorization: Bearer <token>` header.
