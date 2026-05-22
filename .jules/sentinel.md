## 2025-02-28 - FastAPI Catch-All Path Traversal (LFI)
**Vulnerability:** A local file inclusion (LFI) path traversal vulnerability existed in `server/main.py` where a dynamic user-provided `full_path` was appended to a `dist_dir` path to serve arbitrary files using `FileResponse`, allowing attackers to use `../` inside the path to read sensitive backend files.
**Learning:** `FileResponse` in FastAPI does not perform boundary checks like `StaticFiles` does. If user input is concatenated and passed directly to `FileResponse`, an attacker can read files outside the intended directory.
**Prevention:** Always resolve the final target path using `.resolve()` and enforce that it `.is_relative_to(base_dir.resolve())` before passing the path to `FileResponse`.
