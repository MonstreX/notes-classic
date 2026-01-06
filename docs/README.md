# Notes Classic - Technical Documentation

Notes Classic is a local-first desktop app inspired by classic Evernote (2015 era). It runs in Tauri v2 with a Rust backend and a vanilla TypeScript frontend. The UI is a three-panel layout with notebooks, notes list, and a rich text editor.

## Architecture Overview

Frontend and backend are decoupled. The UI calls Rust commands through Tauri IPC. The backend manages SQLite, file storage, and OCR indexing.

### Tech Stack
- **Frontend**: Vanilla TypeScript, Vite, SCSS
- **Editor**: Jodit WYSIWYG (custom toolbar + custom blocks)
- **Syntax Highlight**: highlight.js (code blocks)
- **OCR**: tesseract.js (eng + rus)
- **Backend**: Rust (Tauri v2)
- **Database**: SQLite via `sqlx`

---

## Storage Layout (Portable Mode)

By default, all user data is stored next to the executable (portable layout). The storage root can be changed in Settings; the app can copy the current storage or switch to an existing one.

```text
./data/notes.db          # SQLite database
./data/files/            # Note resources and attachments
./data/backups/          # Automatic backups (import/storage changes)
./settings/app.json      # UI + app settings (including storage override + language)
./resources/ocr/tessdata # OCR language data (eng, rus) shipped with the app
```

If the app cannot write to the chosen storage folder, it shows an error and aborts startup.

---

## Project Structure

```text
notes-classic/
  docs/                      # Project documentation
  src/                       # Frontend source (vanilla TS)
    assets/                  # Static assets (icons sprite, etc.)
    controllers/             # App orchestration
    services/                # Domain + IPC helpers
    state/                   # In-memory store + types
    styles/                  # SCSS styles
    ui/                      # UI modules (DOM + events)
  src-tauri/                 # Rust backend
    icons/                   # App icon
    resources/               # Bundled resources (i18n, OCR tessdata)
    src/                     # Rust sources
    Cargo.toml               # Rust dependencies
  settings/                  # User settings (portable)
  data/                      # User data (portable)
```

---

## Features Implemented

### 1. Three-Panel Interface
- **Sidebar**: Notebooks and tags with collapse/expand.
- **Note List**: Sorting, view modes, and selection.
- **Multi-selection**: Shift/Ctrl selection, group move/delete, and drag groups to tags or Trash.
- **Editor**: Jodit-based rich text editing with custom callouts, code blocks, TODO lists, and encrypted content blocks.
- **Attachments**: Attach files via toolbar or drag-and-drop, with download/view/delete actions.

### 2. Notebooks and Stacks
- Two-level structure: stacks (top level) and notebooks (inside stacks).
- Drag-and-drop notebooks across stacks.
- Note list shows notes from selected notebook.

### 3. Tags
- Unlimited nesting.
- Drag-and-drop to move tags under other tags or to root.
- Notes can be filtered by tag.

### 4. Search
- Modal search UI.
- Text search uses `notes_text` index.
- OCR search uses `ocr_text` index and returns notes with image matches.

### 5. Trash
- Notes are deleted to Trash by default (configurable).
- Restore single notes or restore all from the sidebar context menu.
- Trash list shows recently deleted notes.

### 6. OCR Pipeline
- OCR is queued in the frontend via tesseract.js worker.
- Images are processed in background batches with retry/backoff.
- Results are stored in `ocr_text` for search.

### 7. Settings + Localization
- Settings dialog for storage location and delete-to-trash behavior.
- UI language selection (EN/RU) with restart required.
- Default language is picked from the OS on first run.

### 8. Evernote Import (In-App)
- Import from Evernote v10 data folder (RemoteGraph.sql + internal_rteDoc + resource-cache).
- Scan summary before import, staged progress during import.
- Backup created before overwriting storage.
- Restart required after import.

### 9. Notes Classic / Obsidian / HTML / Text Import (In-App)
- Notes Classic export import (manifest-based).
- Obsidian Markdown import with attachments, TODOs, code blocks, and note links.
- HTML import converts `<pre>` to code blocks and rewrites local assets.
- Text import uses Markdown-like syntax for TODOs and code blocks.
- All importers back up current storage and require restart.
- Details: `docs/IMPORTS.md`

### 10. Export (In-App)
- Export full storage to a portable package.
- Includes notes HTML, metadata, attachments, OCR files, tags, and history.
- Details: `docs/EXPORT.md`

---

## Development and Build

### Prerequisites
- Node.js (v18+)
- Rust (stable) and Windows build tools

### Run in Development
```bash
npm run tauri dev
```

### Build Production
```bash
npm run tauri build
```

---

## Future Roadmap (Planned)
- Optional sync with remote server.
