## 2025-02-09 - Path Traversal in FastAPI Catch-All Route
**Vulnerability:** A catch-all route `/{full_path:path}` in `server/main.py` serving SPA files concatenated `dist_dir` with `full_path` without bounds checking, allowing arbitrary file reads via directory traversal (`../../`).
**Learning:** `FileResponse` in FastAPI does not perform automatic boundary checks like `StaticFiles` does, and user input must be explicitly validated against a resolved base directory using `.resolve().is_relative_to(base_dir.resolve())`.
**Prevention:** Always explicitly validate dynamic file paths using `.resolve().is_relative_to()` before returning a `FileResponse`. Ensure base directories and target directories are completely resolved to avoid relative path comparisons evaluating to False.
