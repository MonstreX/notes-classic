## 12) Storage and asset protocol

Storage layout:

- data/notes.db
- data/files/*
- data/backups/*
- resources/ocr/tessdata/*
- settings/app.json

Asset protocol:

- Tauri asset protocol is enabled.
- Scope allows data/** and parent variants for dev.
- convertFileSrc converts local path to asset URL.

File URL scheme:

- Note HTML stores relative paths: files/<path>.
- content.ts converts files/ to asset URLs on display.
- Legacy notes-file URLs are normalized to files/ during migration.

Portable path resolution:

- Uses executable directory by default.
- In dev, uses repository root (package.json + src-tauri).
- Ensures directories are writable on startup.
- If settings/app.json contains dataDir, storage is redirected there.
- Changing storage path can copy existing data or switch to an existing storage.
- A restart is required after storage changes.
- Storage changes create a backup under data/backups.

----------------------------------------------------------------
