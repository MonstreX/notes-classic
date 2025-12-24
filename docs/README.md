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

## Project Structure

```text
notes-classic/
├── docs/                  # Project documentation
├── src/                   # Frontend source code (React + TypeScript)
│   ├── assets/          # Static assets
│   ├── components/      # React components (Editor, etc.)
│   ├── App.tsx          # Main application layout and logic
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles and Tailwind directives
├── src-tauri/             # Backend source code (Rust)
│   ├── icons/           # Application icons for different platforms
│   ├── src/
│   │   ├── db.rs       # SQLite database initialization and Repository Pattern
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
- **Sidebar**: Dark-themed (#1A1A1A) navigation with a distinct "New Note" button (#00A82D).
- **Note List**: Searchable list of notes with real-time filtering and selection.
- **Note View**: Clean, white-background editor area with a prominent title field.

### 2. Rich Text Editor (TipTap)
- Full WYSIWYG support.
- **Code Highlighting**: Integrated `CodeBlockLowlight` using `highlight.js` (GitHub Dark theme).
- **Tables**: Support for creating and managing tables within notes.
- **Task Lists**: Interactive checklists with checkboxes.
- **Placeholder**: Contextual "Start writing..." prompt.
- **Typography**: Optimized for readability using `@tailwindcss/typography`.

### 3. Local Persistence (SQLite)
- All data is stored in a local SQLite database named `notes_classic.db`.
- **Location**: Database is stored in the user's local AppData directory (`%APPDATA%/com.notes-classic.app`).
- **Schema**:
  - `id`: Primary key (Integer).
  - `title`: Note title (Text).
  - `content`: Note HTML content (Text).
  - `created_at` / `updated_at`: Unix timestamps (Integer).
  - `sync_status`: Reserved for future cloud sync (0 - local, 1 - synced).
  - `remote_id`: Reserved for future cloud sync.

### 4. Application Logic
- **Autosave**: Notes are automatically saved to the database 1 second after the last change.
- **CRUD**: Full support for Creating, Reading, Updating, and Deleting notes.
- **Repository Pattern**: Rust backend uses a trait-based repository pattern, making it easy to swap SQLite for other storage or add Cloud sync services in the future.

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
The output `.exe` and installers will be located in `src-tauri/target/release/bundle/`.

---

## Future Roadmap (Planned)
- [ ] **Attachments**: Store images and files in a local `attachments/` folder.
- [ ] **Cloud Sync**: Integrate with a remote API using the existing `sync_status` fields.
- [ ] **Code Block Language Selector**: UI dropdown to manually select highlighting language.
- [ ] **Tags**: Categorize notes using tags.
