# Notes Classic - Technical Documentation

Notes Classic is a local-first desktop application inspired by the Evernote 2020 aesthetic. It is built using the Tauri framework, combining a high-performance Rust backend with a modern React frontend.

## Architecture Overview

The project follows a decoupled architecture where the frontend (React) communicates with the backend (Rust) via Tauri's IPC (Inter-Process Communication) layer.

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS.
- **Backend**: Rust (Tauri).
- **Database**: SQLite (managed via `sqlx`).
- **Editor**: TipTap (WYSIWYG) with custom extensions.
- **Drag-and-Drop**: `@dnd-kit/core` for robust cross-platform interactions.
- **Icons**: Lucide React.

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
│   ├── App.tsx          # Main application logic, DND context, and Layout
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

### 1. Three-Panel Resizable Interface
- **Sidebar**: Dark-themed (#1A1A1A). Now includes **resizable width**.
- **Note List**: Searchable list with **resizable width**.
- **Note View**: Fixed-size typography for consistent reading experience.

### 2. Nested Notebooks (Categories)
- Support for hierarchical notebook structures (sub-folders).
- Recursive rendering in the sidebar.
- Create sub-notebooks directly from the parent item.

### 3. Advanced Note Management
- **Drag-and-Drop**: Notes can be dragged from the list and dropped onto notebooks in the sidebar using `dnd-kit`.
- **Custom Context Menu**: Right-click any note to move it to a specific notebook via a dedicated menu.
- **Native Dialogs**: All deletions require confirmation via native Tauri system dialogs (`ask`).

### 4. Rich Text Editor (TipTap)
- **Toolbar**: Full control over Bold, Italic, Strikethrough, Headings, Lists, Task Lists, Code Blocks, and Tables.
- **Code Highlighting**: Integrated `CodeBlockLowlight` with GitHub Dark theme.
- **Fixed Typography**: Fonts no longer scale with window size, ensuring a stable layout.

### 5. Persistence and Logic
- **SQLite**: Automatic database initialization and schema migrations.
- **Autosave**: Changes are committed to the local DB 1 second after typing stops.
- **Repository Pattern**: Abstracted data layer in Rust for future-proofing.

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

## Future Roadmap
- [ ] **Attachments**: Implementation of the `attachments/` folder for local file storage.
- [ ] **Cloud Sync**: Integration with remote sync services.
- [ ] **Tags**: Global tagging system for cross-notebook organization.