# Odessa — instructions for Claude Code

> **Read `docs/ENGINEERING-STANDARDS.md` before implementing anything.** It is the
> single source of truth for how work is done here (any agent, any model):
> Issues, Pull Requests, the quality pipeline, tests, observability, security,
> architecture and UI/motion rules. The summary below does not replace it.

## Workflow: Issue → Pull Request → merge → deploy

1. **Every task starts as a GitHub Issue** classified as **Correção** (`correcao`),
   **Melhoria** (`melhoria`) or **Nova função** (`nova-funcao`). Use the templates
   in `.github/ISSUE_TEMPLATE`; search for duplicates first. Anything you notice
   outside the task's scope becomes a new issue, not part of the same PR.
2. **Work on a branch — never commit or push directly to `main`.** Start from an
   up-to-date `main` (`git fetch origin main`).
3. **Open a Pull Request** to `main` using `.github/PULL_REQUEST_TEMPLATE.md`. Every PR must:
   - mention the related Issue (`Closes #N` / `Refs #N`);
   - explain what changed;
   - describe how it was validated (commands run and their results);
   - record risks, limitations and next steps.
4. Commits follow Conventional Commits with the description in Portuguese
   (`feat:` Nova função, `fix:` Correção, `refactor:`/`perf:`/`docs:`/`test:`/`ci:`/`chore:` Melhoria). Commitlint enforces it on the PR.
5. **Merge only with the pipeline green.** Before pushing, run:
   ```bash
   pnpm check                  # lint, typecheck, arch-contract, Knip, unit + integration tests
   pnpm build && pnpm budget   # build + performance budget
   pnpm test:e2e               # when UI changed (Playwright, needs the build)
   PYTHONPATH=. pytest server/tests tests   # when the backend changed
   ```
6. **Deploy only from `main`, after the PR is merged.**

Codex follows the same flow (see `AGENTS.md`), so both agents stay in sync
through PRs instead of pushing to `main`.

## UI and motion

Use the **Design Motion Principles** skill in `.claude/skills/design-motion-principles`
(Emil lens: fast, restrained, purposeful). Every screen needs lazy loading where
it makes sense, skeletons while loading (`PanelSkeleton`, `SkeletonList`), smooth
enter **and** exit (`usePresence`, `Modal`, `.od-pop`), progress state on
interactive elements (`Button loading`), visual feedback (`useToast`), and only
the motion tokens in `src/ux-polish.css` §9. Reuse the components listed in
`docs/ENGINEERING-STANDARDS.md` §6 instead of rebuilding them. Before finishing,
review the UI as a senior product designer and fix anything abrupt, janky,
generic or amateur.

## Deploy

Deploys go to Hostinger at `darkgrey-shark-457698.hostingersite.com`, **from `main`
after the PR is merged**.

Build + zip + deploy:

```powershell
npx vite build
Compress-Archive -Path dist, api, public, src, package.json, pnpm-lock.yaml, hostinger-server.mjs, vite.config.ts, tsconfig.json, .hostinger.json, index.html -DestinationPath deploy.zip -Force
```

Then call `mcp__hostinger-mcp__hosting_deployJsApplication` with `archivePath` pointing at `deploy.zip` and `domain` = `darkgrey-shark-457698.hostingersite.com`.


## API routing gotcha

Hostinger only invokes API handlers that exist as physical files in `api/`.
The catch-all `api/[...path].js` is **not** picked up for routes that don't have a matching file (e.g. `/api/v1/workflow/profiles` needs `api/v1/workflow/profiles.js`).

When adding a new endpoint, **always create a dedicated file** with the handler logic self-contained (no shared imports from app code — Vercel-style serverless functions don't reliably resolve those on Hostinger). ESLint enforces this (`no-restricted-imports` for `api/**/*.js`).

## Auth (for testing endpoints)

Use the admin email and password configured in the server's environment variables (`ODESSA_ADMIN_PASSWORD` / `ODESSA_ADMIN_PASSWORD_HASH`).
Session token comes back as `sessionToken` in the login response and goes in the `Authorization: Bearer <token>` header.
Login is rate limited (10 attempts/min per IP by default — `ODESSA_RATE_LIMIT_LOGIN_PER_MIN`).
