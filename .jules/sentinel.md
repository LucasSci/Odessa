## 2026-05-26 - [LFI in FastAPI Static Serving]
**Vulnerability:** A catch-all route `/{full_path:path}` in `server/main.py` using `FileResponse` permitted directory traversal (Local File Inclusion / LFI) because it didn't strictly validate that the requested path stayed inside the `dist_dir`.
**Learning:** `FileResponse` in FastAPI does not perform automatic boundary checks like `StaticFiles` does. When serving paths dynamically with `FileResponse`, user input is dangerously exposed if it's directly concatenated with the base directory without explicit checks.
**Prevention:** Always validate that dynamically resolved paths are contained within the intended base directory using `target.resolve().is_relative_to(base_dir.resolve())` before passing them to `FileResponse` or `open()`.
