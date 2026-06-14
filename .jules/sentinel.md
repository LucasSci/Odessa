
## 2026-06-14 - Fix Path Traversal Vulnerability in SPA Catch-all Route
**Vulnerability:** A Local File Inclusion (LFI) vulnerability existed in `server/main.py` where a dynamic catch-all route `/{full_path:path}` used for serving SPA static files used user-supplied input to construct a file path without verifying the boundary.
**Learning:** `pathlib.Path.is_file()` merely resolves to whether an absolute path on the machine points to a file, bypassing intended base directories. When serving static files dynamically with `FileResponse`, built-in path protection isn't inherently applied.
**Prevention:** Always combine absolute path resolution and a boundary check, such as `target.resolve().is_relative_to(base_dir.resolve())`, before returning user-specified static files.
