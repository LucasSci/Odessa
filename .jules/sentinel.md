## 2026-06-12 - FileResponse Built-in Path Boundary Checks Missing
**Vulnerability:** Path Traversal (LFI) allowing an attacker to read arbitrary files via the `/{full_path:path}` catch-all SPA route using `../` in the path.
**Learning:** FastAPI's `FileResponse` does not provide the built-in boundary checks that `StaticFiles` does, allowing developers to unknowingly expose arbitrary files when manually resolving paths.
**Prevention:** When manually serving dynamic paths in FastAPI (e.g., using a catch-all route with `FileResponse`), always use `target.resolve().is_relative_to(base_dir.resolve())` to explicitly prevent path traversal/LFI vulnerabilities.
