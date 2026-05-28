## 2026-05-28 - [Path Traversal in FastAPI Static Files]
**Vulnerability:** A catch-all route at `/{full_path:path}` combined user input directly with a base directory (`dist_dir / full_path`) and served it via `FileResponse(target)`. This allowed arbitrary read access via path traversal (`../`).
**Learning:** `FileResponse` does not provide the built-in boundary checks that `StaticFiles` does. FastAPI and underlying Starlette automatically decode URL-encoded characters (like `%2e%2e%2f`), passing `../` to the route handler.
**Prevention:** Always use `path.resolve().is_relative_to(base_dir.resolve())` to explicitly assert the resolved path is safely bounded within the target directory when manually serving files or dynamic paths.
