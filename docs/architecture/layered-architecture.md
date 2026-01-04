## 4) Layered architecture

### 4.1 UI layer (src/ui)

The UI layer:

- Creates DOM nodes.
- Renders current state.
- Registers event handlers.
- Emits user intent via handler interfaces.
- Contains no database or file IO.

It is composed of modules:

- appShell.ts
- sidebar.ts
- notesList.ts
- editor.ts
- searchModal.ts
- metaBar.ts
- tagsBar.ts
- contextMenu.ts
- dialogs.ts
- icons.ts

### 4.2 Controller layer (src/controllers)

The controller:

- Loads data from services.
- Updates the store.
- Normalizes selection logic.
- Manages autosave and debounce.
- Owns state transitions.

Only appController.ts exists today.

### 4.3 State layer (src/state)

The state layer:

- Holds AppState object.
- Supports subscribe/notify.
- Updates use shallow merges.

### 4.4 Service layer (src/services)

The service layer:

- Wraps Tauri invoke calls.
- Normalizes content and URLs.
- Manages OCR worker queue.
- Handles settings persistence.
- Provides crypto helpers for encrypted editor blocks.

### 4.5 Backend layer (src-tauri)

The backend:

- Resolves portable paths.
- Creates and migrates schema.
- Serves legacy notes-file protocol for older content.
- Exposes IPC commands.
- Contains repository methods.

----------------------------------------------------------------
