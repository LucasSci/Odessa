## 2026-06-07 - Mitigate LFI in SPA catch-all route
**Vulnerability:** Path traversal vulnerability in `serve_web_app` route in `server/main.py` allowing unauthenticated attackers to read arbitrary files on the filesystem.
**Learning:** `FileResponse` doesn't provide built-in boundary checks for paths, unlike `StaticFiles`. The `full_path` was directly concatenated to `dist_dir` without validation.
**Prevention:** Always use `path.resolve().is_relative_to(base_dir.resolve())` to ensure the final path doesn't escape the expected base directory.
