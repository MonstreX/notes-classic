## 3) Source tree and responsibilities

Repository root:

- docs/              Documentation.
- src/               Frontend code (vanilla TS + SCSS).
- src-tauri/         Rust backend.
- data/              User data (notes.db, files, backups).
- src-tauri/resources/ocr/tessdata  OCR language data bundled with the app.
- settings/          User settings (app.json).
- scripts/           Import scripts and utilities.

Frontend tree:

- src/main.ts        App entry, CSS imports, icon sprite injection.
- src/ui/            UI modules (DOM + events).
- src/controllers/   Orchestration and actions.
- src/services/      IPC wrappers and content utilities.
- src/state/         In-memory store and types.
- src/styles/        SCSS (base, layout, components).

Backend tree:

- src-tauri/src/main.rs  Tauri bootstrap and IPC commands.
- src-tauri/src/db.rs    Schema, migrations, repository queries.
- src-tauri/icons/       App icon.
- src-tauri/tauri.conf.json  Tauri configuration.

----------------------------------------------------------------
