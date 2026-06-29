## 2024-05-18 - [Path Traversal in FastAPI catch-all route]
**Vulnerability:** Path traversal (LFI) vulnerability in `serve_web_app` catch-all route in `server/main.py`. The `is_file()` check on `pathlib.Path` objects returns `True` for valid files even if they are outside the expected directory.
**Learning:** `pathlib.Path(...).is_file()` does not inherently prevent path traversal. It simply checks if the path points to an existing file, regardless of whether it resides outside the base directory. Using `FileResponse` to serve user-provided paths without boundary checking leads to LFI.
**Prevention:** Always use `path.resolve().is_relative_to(base_dir.resolve())` to ensure the path stays within the intended directory before serving it.
