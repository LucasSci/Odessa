# Odessa — instructions for Codex

## Base44 dev environment

The Base44 sandbox runs the app via `docker-compose.base44.yml` (two services):
- **web** — Node 22 + Vite dev server on port 3000, bind-mounted source, live reload.
- **api** — Python 3.12 + uvicorn on port 8000 (internal), bind-mounted source, `--reload`.
- A one-shot **api-setup** service creates a venv (named volume `pyenv`) and installs `server/requirements-container.txt` (trimmed — excludes `pyautogui`, `easyocr`, `kokoro`, `soundfile` which need system libs or are heavy; all are lazy-loaded with fallbacks).

The Vite proxy target is configurable via `VITE_API_PROXY_TARGET` (defaults to `http://127.0.0.1:8000` for local dev; set to `http://api:8000` in compose). `allowedHosts: true` is set so the preview's external hostname is accepted.

The app boots in **simulation mode** (`SIMULATION_MODE=true`, `ENABLE_LOCAL_FALLBACK=true`) with no external secrets. Auth is disabled (`auth-disabled-2026-05-16` — login always succeeds). AI keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are optional.

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

To verify the bridge end-to-end:
`curl -sf http://localhost:3000/api/v1/chat-automation/bridge/status` →
`bridgeStatus.status` should be `connected` with `observerInjected: true`.
`curl -sf http://localhost:3000/tango-bridge/screenshot -o /tmp/live.jpg` →
returns a JPEG of the live page.

## Branch policy: work directly on `main`

This project is also edited via **Codex** (which pushes to `main` directly).
To keep both agents in sync, Codex should also work on `main` — **not** in worktrees or feature branches.

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

## API routing gotcha

Hostinger only invokes API handlers that exist as physical files in `api/`.
The catch-all `api/[...path].js` is **not** picked up for routes that don't have a matching file (e.g. `/api/v1/workflow/profiles` needs `api/v1/workflow/profiles.js`).

When adding a new endpoint, **always create a dedicated file** with the handler logic self-contained (no shared imports from app code — Vercel-style serverless functions don't reliably resolve those on Hostinger).

## Auth (for testing endpoints)

Use the admin email and password configured in the server's environment variables (`ODESSA_ADMIN_PASSWORD` / `ODESSA_ADMIN_PASSWORD_HASH`).
Session token comes back as `sessionToken` in the login response and goes in the `Authorization: Bearer <token>` header.
