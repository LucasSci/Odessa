## 2025-02-27 - LFI Vulnerability in FastAPI FileResponse

**Vulnerability:** Path Traversal (LFI) vulnerability in `server/main.py` SPA fallback routing, which allowed `../` sequences to traverse outside the allowed static file directory.
**Learning:** `FileResponse` in FastAPI does not perform path boundary checks automatically (unlike `StaticFiles`). Using user-provided strings to construct `Path` objects and passing them to `FileResponse` inherently opens up traversal attacks.
**Prevention:** Always use `target.resolve().is_relative_to(base_dir.resolve())` to restrict dynamically constructed file paths in fallback/catch-all routes.
