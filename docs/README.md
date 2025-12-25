# Notes Classic - Technical Documentation

Notes Classic is a local-first desktop application inspired by the Evernote 2020 aesthetic. It is built using the Tauri framework, combining a high-performance Rust backend with a modern React frontend.

## Architecture Overview

The project follows a decoupled architecture where the frontend (React) communicates with the backend (Rust) via Tauri's IPC (Inter-Process Communication) layer.

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS.
- **Backend**: Rust (Tauri).
- **Database**: SQLite (managed via `sqlx`).
- **Editor**: TipTap (WYSIWYG) with custom extensions.
- **Icons**: Lucide React.

---

## Storage Layout (Portable Mode)

All user data is stored next to the application executable (portable-only layout).

```text
./data/notes.db        # SQLite database
./data/assets/         # Attachments and embedded files (planned)
./settings/app.json    # UI and app settings
```

If the app cannot write to the executable folder, it shows an error and aborts startup.

---

## Project Structure

```text
notes-classic/
├── docs/                  # Project documentation
├── src/                   # Frontend source code (React + TypeScript)
│   ├── assets/          # Static assets
│   ├── components/      # React components
│   │   ├── Editor.tsx   # TipTap Editor wrapper
│   │   └── Toolbar.tsx  # Rich-text editor controls
│   ├── App.tsx          # Main application logic and Layout
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles and Tailwind directives
├── src-tauri/             # Backend source code (Rust)
│   ├── icons/           # Application icons
│   ├── src/
│   │   ├── db.rs       # SQLite schema, migrations, and Repository Pattern
│   │   └── main.rs     # Tauri command handlers and app lifecycle
│   ├── build.rs         # Tauri build script
│   └── Cargo.toml       # Rust dependencies
├── index.html             # Main HTML entry
├── tailwind.config.js     # Tailwind CSS configuration
└── tauri.conf.json        # Tauri app configuration
```

---

## Features Implemented

### 1. Three-Panel Interface
- **Sidebar**: Dark-themed (#1A1A1A). Features perfect vertical alignment of notebook icons under the "All Notes" section.
- **Note List**: Searchable list with real-time filtering and selection. Supports resizable width.
- **Note View**: Clean, white-background editor area with fixed typography for a consistent reading experience.

### 2. Nested Notebooks (Categories)
- Support for hierarchical structures (parent and sub-notebooks).
- **Recursive Note Retrieval**: Selecting a parent notebook automatically displays notes from all its descendant sub-notebooks using recursive SQL CTE queries.
- **Management**: Quick actions for creating sub-notebooks, toggling expansion, and deletion.

### 3. State Persistence
- **Window State**: Automatically saves and restores window position and size using the `tauri-plugin-window-state`.
- **UI State**: Remembers panel widths, the last selected note/notebook, and which folders were expanded in the sidebar via `./settings/app.json`.

### 4. Rich Text Editor (TipTap)
- **Toolbar**: Controls for Bold, Italic, Strikethrough, Headings, Lists, Task Lists, Code Blocks, and Tables.
- **Code Highlighting**: Integrated `CodeBlockLowlight` with GitHub Dark theme support.
- **Autosave**: Changes are committed to the local SQLite database 1 second after the last keystroke.

### 5. Data Safety
- All destructive actions (deleting notes or notebooks) require explicit confirmation via native system dialogs.

---

## Development and Build

### Prerequisites
- Node.js (v18+)
- Rust (stable) and C++ Build Tools for Windows.

### Run in Development Mode
```bash
npm run tauri dev
```

### Build Production Bundle
```bash
npm run tauri build
```

---

## Future Roadmap (Planned)
- [ ] **Evernote Import (EXB)**: Import notebooks, stacks, notes, and resources from the Evernote Windows local database.
- [ ] **Evernote Import (ENEX)**: Fallback import to a single notebook when only `.enex` is available.
- [ ] **Attachments**: Support for local file storage in `./data/assets/`.
- [ ] **Cloud Sync**: Optional synchronization with a remote backend.

---

## Evernote Import Plan (Draft)

### Data Sources
- **Primary**: `Databases/fido6080net.exb` (SQLite database).
- **Fallback**: `Evernote.enex` (notes only, no notebook/stack structure).

### Notebooks and Stacks
- `notebook_attr.name` -> Notebook name.
- `notebook_attr.stack` -> Stack name (top-level group).
- Only two levels are used (stack -> notebook), matching Notes Classic structure.

### Notes
- `note_attr` provides note metadata (title, dates, notebook_uid).
- Note ENML is stored in `attrs` where `uid = note_attr.uid` and `aid = 34`.

### Resources (Attachments)
- `resource_attr` links resources to a note (`note`) and provides `hash`, `mime`, `file_name`.
- `resources.data` contains binary data; `resource_attr.hash` is the hex md5 used by `<en-media hash="...">`.
- Importer writes files into `./data/assets/` and rewrites ENML links accordingly.

### Date Conversion
- Evernote timestamps in `note_attr` are days since `0001-01-01`.
- Importer converts to Unix timestamps for storage.

### ENEX Fallback
- `.enex` contains notes, content, and resources but no stacks/notebooks.
- Imported into a single notebook (e.g., "Evernote Import").
