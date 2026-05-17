## 2026-05-17 - FastAPI Static File Path Traversal
**Vulnerability:** Found a Path Traversal / Local File Inclusion (LFI) vulnerability in `server/main.py` where a dynamic catch-all route `@app.get("/{full_path:path}")` appended `full_path` to `dist_dir` directly without boundary checks. This allowed fetching files outside the static directory (e.g., `../../test_secret.txt`).
**Learning:** The vulnerability existed because raw user input from the URL path was concatenated to a base path to serve static files manually using `FileResponse`, bypassing the built-in security of `StaticFiles`.
**Prevention:** Always use `path.resolve().is_relative_to(base_dir.resolve())` to verify that dynamic paths remain within intended boundaries before serving files or reading them from the filesystem.
