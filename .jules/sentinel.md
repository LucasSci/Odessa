## 2026-06-05 - Fix Path Traversal in static file serving
**Vulnerability:** A path traversal vulnerability (LFI) in `server/main.py` allowed an attacker to read any file on the host filesystem by passing `../` sequences to the catch-all `/{full_path:path}` endpoint.
**Learning:** `FastAPI` TestClient normalizes `../` automatically, masking this vulnerability during typical unit testing. The underlying `pathlib` API `.is_relative_to()` only works securely if both the target and base paths are strictly `.resolve()`d first.
**Prevention:** Always use `target = (base_dir / input_path).resolve()` and verify boundary with `target.is_relative_to(base_dir.resolve())` before serving files dynamically. Test for path traversals using raw HTTP requests/sockets rather than just FastAPI's TestClient.
