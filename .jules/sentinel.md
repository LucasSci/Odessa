## 2026-05-06 - [High] Path Traversal in Video Upload/Download
**Vulnerability:** Path traversal existed in `server/api/v1/endpoints/video.py` and `server/core/video_files.py`. In upload, `UploadFile.filename` was used directly in paths without sanitization. In retrieval, `video_id` wasn't sanitized, allowing arbitrary file reads outside `video_dir`.
**Learning:** This repo lacked centralized path validation. FastAPI's `UploadFile` returns raw filenames which can include directory traversal (`../`) characters. Pathlib's `/` operator does not automatically sanitize.
**Prevention:** Always use `os.path.basename` on incoming filenames. When resolving paths using dynamic IDs, enforce directory boundaries using `.resolve()` and `.is_relative_to(base_dir)`.
