## 2026-05-18 - Path Traversal in FastAPI FileResponse
**Vulnerability:** A catch-all route `/{full_path:path}` in `server/main.py` passed user input directly to `FileResponse` without resolving the path and checking if it stayed within the intended directory boundaries, allowing LFI (Local File Inclusion).
**Learning:** FastAPI's `StaticFiles` has built-in boundary checks, but `FileResponse` does not. When manually serving files with `FileResponse`, path traversal vulnerabilities can occur if the user controls any part of the path.
**Prevention:** Always use `target.resolve().is_relative_to(base_dir.resolve())` to ensure the resolved file path is strictly within the allowed base directory before serving it with `FileResponse`.
