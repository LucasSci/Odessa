
## $(date +%Y-%m-%d) - Path Traversal (LFI) in Catch-all Route
**Vulnerability:** The FastAPI catch-all route `/{full_path:path}` resolved files dynamically against the `dist` directory without boundary verification, enabling Local File Inclusion (LFI). Attackers could use `../` to access files outside the `dist` directory (e.g., `server/config.py`).
**Learning:** `FileResponse` doesn't provide the built-in boundary checks that `StaticFiles` does. `fastapi.testclient.TestClient` prematurely normalizes relative paths, masking the vulnerability in basic testing unless using `curl --path-as-is` or raw sockets.
**Prevention:** Always use `target.resolve().is_relative_to(base_dir.resolve())` to restrict path traversal and perform bounds validation when dynamically serving files. Remember to use `base_dir.resolve()` since `Path.is_relative_to` requires an absolute base path when checking against an absolute resolved target.
