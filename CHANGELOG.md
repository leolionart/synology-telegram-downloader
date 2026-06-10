# Changelog

## 2026-06-11

- Renamed the project to Synology Telegram Downloader.
- Updated Docker Compose examples and GHCR publishing to use the `synology-telegram-downloader` slug.
- Cleaned up README and documentation to frame the project as an independent tool.
- Updated Docker Compose to use the published GHCR image by default.
- Upgraded the bot to support full command-driven operations (`/start`, `/help`, `/dl`, `/queue`, `/status`, `/cancel`, `/retry`, `/history`, `/downloads`, `/setdir`, `/config`, `/health`) with in-memory job status tracking, persistent history, admin authorization limits (`ADMIN_CHAT_IDS`), and health audits.
