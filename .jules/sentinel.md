## 2025-02-26 - FastAPI FileResponse Path Traversal
**Vulnerability:** Path traversal (LFI) vulnerability in the fallback catch-all route `/{full_path:path}` used for serving the Single Page Application (SPA).
**Learning:** FastAPI's `FileResponse` does not include the built-in path boundary checks that `StaticFiles` provides. Furthermore, `pathlib.Path(...).is_file()` evaluates to True as long as the resolved absolute path points to a valid file, meaning it does not inherently prevent path traversal when evaluating user-provided paths.
**Prevention:** When manually serving static files or dynamic paths in FastAPI (e.g., using `FileResponse`), always explicitly verify path boundaries using `target.resolve().is_relative_to(base_dir.resolve())` before serving the file.
