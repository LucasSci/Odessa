## 2026-05-20 - Fix Path Traversal in FastAPI catch-all route
**Vulnerability:** A catch-all route (`@app.get("/{full_path:path}")`) passed user input directly to `FileResponse(dist_dir / full_path)` without verifying if the requested file was actually inside the target directory.
**Learning:** `FileResponse` in FastAPI does not perform boundary checks like `StaticFiles` does. Combining user input with `pathlib`'s `/` operator can result in arbitrary directory traversal (e.g. `../../etc/passwd` or absolute paths like `/etc/passwd` escaping the intended root).
**Prevention:** Always use `path.resolve().is_relative_to(base_dir.resolve())` to prevent path traversal when manually serving static files or dynamic paths using `FileResponse`.
