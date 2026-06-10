## 2026-06-10 - LFI / Path Traversal in FastAPI Catch-all Route
**Vulnerability:** A path traversal (LFI) vulnerability existed in `server/main.py` where a catch-all route `/{full_path:path}` served files from `dist_dir` directly via `FileResponse(dist_dir / full_path)` without verifying if the resolved path stayed within `dist_dir`.
**Learning:** `FileResponse` does not provide the built-in directory boundary checks that `StaticFiles` offers. Relying solely on `dist_dir / full_path` allows `../` sequences to escape the directory.
**Prevention:** When manually serving dynamic paths with `FileResponse`, always explicitly resolve both the target and base paths using `.resolve()` and verify bounds using `target.is_relative_to(base_dir.resolve())`.
