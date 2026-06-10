# Changelog

## 2026-06-11

- Added duplicate and similar movie file detection. Automatically replaces exact duplicate filenames and prompts the user with inline choices (Replace/Keep/Cancel) for files with different quality/source suffixes (like CAM, 1080p, BluRay, etc.).
- Renamed the project to Synology Telegram Downloader.
- Updated Docker Compose examples and GHCR publishing to use the `synology-telegram-downloader` slug.
- Cleaned up README and documentation to frame the project as an independent tool.
- Updated Docker Compose to use the published GHCR image by default.
- Upgraded the bot to support full command-driven operations (`/start`, `/help`, `/dl`, `/queue`, `/status`, `/cancel`, `/retry`, `/history`, `/downloads`, `/setdir`, `/config`, `/health`) with in-memory job status tracking, persistent history, admin authorization limits (`ADMIN_CHAT_IDS`), and health audits.
- Registered the Telegram command menu and documented how to pull/recreate the container for new GHCR image builds.
- Added quick folder selection with `/folders`, reply keyboard shortcuts, and inline folder buttons.
