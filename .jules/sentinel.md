## 2026-06-17 - [Path Traversal in FastAPI FileResponse]
**Vulnerability:** Path traversal (LFI) in the FastAPI catch-all SPA route allowing access to arbitrary local files via `..` payloads.
**Learning:** `pathlib.Path.is_file()` only verifies if a file exists on disk, it does not provide boundary checking.
**Prevention:** Always use `target.resolve().is_relative_to(base_dir.resolve())` when directly serving files with `FileResponse`.
