# Changelog

## 2026-06-26

- Fixed connection issues and DNS resolution errors (`getaddrinfo EAI_AGAIN`) on Synology NAS Docker by forcing IPv4 (`family: 4`) for Telegram Bot API requests.
- Added HTTP/HTTPS proxy support using system environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy`).
- Added cleaner logging for `polling_error` and `error` events to prevent log spamming and make diagnostics easier.
- Sanitized `workersUrl` to remove any trailing slash to prevent double-slash path resolution issues.
- Fixed generic filename resolution (e.g. `download.aspx`) by sending a `HEAD` request to query the `Content-Disposition` header from the direct redirect URL, extracting the original filename and file format correctly.
- Handled double-slash path normalization redirects by following redirect URLs in a loop, and added `findpath` / `0:findpath` to generic/invalid filename checks to ensure correct names are resolved for root files.

## 2026-06-11

- Added duplicate and similar movie file detection. Automatically replaces exact duplicate filenames and prompts the user with inline choices (Replace/Keep/Cancel) for files with different quality/source suffixes (like CAM, 1080p, BluRay, etc.).
- Renamed the project to Synology Telegram Downloader.
- Updated Docker Compose examples and GHCR publishing to use the `synology-telegram-downloader` slug.
- Cleaned up README and documentation to frame the project as an independent tool.
- Updated Docker Compose to use the published GHCR image by default.
- Upgraded the bot to support full command-driven operations (`/start`, `/help`, `/dl`, `/queue`, `/status`, `/cancel`, `/retry`, `/history`, `/downloads`, `/setdir`, `/config`, `/health`) with in-memory job status tracking, persistent history, admin authorization limits (`ADMIN_CHAT_IDS`), and health audits.
- Registered the Telegram command menu and documented how to pull/recreate the container for new GHCR image builds.
- Added quick folder selection with `/folders`, reply keyboard shortcuts, and inline folder buttons.
