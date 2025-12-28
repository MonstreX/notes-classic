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

All user data is stored next to the executable (portable layout).

```text
./data/notes.db          # SQLite database
./data/files/            # Note resources and images
./data/ocr/tessdata/     # OCR language data (eng, rus)
./settings/app.json      # UI + app settings
```

If the app cannot write to the executable folder, it shows an error and aborts startup.

---

## Project Structure

```text
notes-classic/
?? docs/                      # Project documentation
?? src/                       # Frontend source (vanilla TS)
?  ?? assets/                 # Static assets (icons sprite, etc.)
?  ?? controllers/            # App orchestration
?  ?? services/               # Domain + IPC helpers
?  ?? state/                  # In-memory store + types
?  ?? styles/                 # SCSS styles
?  ?? ui/                     # UI modules (DOM + events)
?  ?? components/             # Legacy (unused)
?  ?? hooks/                  # Legacy (unused)
?? src-tauri/                 # Rust backend
?  ?? icons/                  # App icon
?  ?? src/                    # Rust sources
?  ?? Cargo.toml              # Rust dependencies
?? settings/                  # User settings
?? data/                      # User data
```

---

## Features Implemented

### 1. Three-Panel Interface
- **Sidebar**: Notebooks and tags with collapse/expand.
- **Note List**: Sorting, view modes, and selection.
- **Editor**: Jodit-based rich text editing with custom callouts, code blocks, and TODO lists.

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

### 5. OCR Pipeline
- OCR is queued in the frontend via tesseract.js worker.
- Images are processed in background batches with retry/backoff.
- Results are stored in `ocr_text` for search.

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
- Evernote import (EXB/ENEX).
- Attachments (non-image files) support.
- Optional sync with remote server.
