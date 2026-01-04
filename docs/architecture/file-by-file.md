## 17) File-by-file notes (exhaustive)

### src/main.ts
- Imports CSS for Jodit and highlight.js.
- Imports main SCSS bundle.
- Injects icons sprite only once.
- Calls mountApp with root element.

### src/ui/appShell.ts
- Constructs main layout and children.
- Wires UI modules to actions.
- Manages resizing and editor update scheduling.
- Subscribes to store and triggers renders.

### src/ui/sidebar.ts
- Renders notebook and tag trees.
- Handles selection and expand states.
- Provides DnD for notebooks and tags.
- Auto-scrolls tags section into view on expand.

### src/ui/notesList.ts
- Renders header and notes list.
- Implements sort menu and view toggle.
- Handles DnD of notes to notebooks.

### src/ui/editor.ts
- Jodit config and event logic.
- Callout and code block custom controls.
- TODO list behavior.
- HR insertion from ---.
- Encrypted content blocks with password prompt and modal viewer.
- Attachment handles, DnD, and preview dialog.

### src/ui/searchModal.ts
- Modal layout and search logic.
- Preview via readonly Jodit.
- OCR status display and highlighting.

### src/ui/metaBar.ts
- Displays stack and notebook context.
- Shows last edited timestamp.

### src/ui/tagsBar.ts
- Tag chips with remove buttons.
- Tag suggestions and add logic.

### src/ui/contextMenu.ts
- Note, notebook, and tag context menus.
- Move To submenu for notes.

### src/ui/dialogs.ts
- Create notebook and tag dialogs.
- Confirmation dialog for destructive actions.
- Password dialog for encrypted blocks.

### src/controllers/appController.ts
- Data fetch orchestration.
- Autosave and selection logic.
- Action map used by UI.

### src/state/store.ts
- AppState definition and update logic.
- Subscriber management.

### src/state/types.ts
- Entity types shared across UI and services.

### src/services/notes.ts
- IPC wrappers for notes and notebooks.

### src/services/tags.ts
- IPC wrappers for tags and note tags.

### src/services/attachments.ts
- IPC wrappers for attachment import/read/delete.

### src/services/content.ts
- Content normalization and asset mapping.

### src/services/settings.ts
- Settings persistence and legacy migration.

### src/services/ocr.ts
- OCR queue, worker, and stats.

### src/services/crypto.ts
- WebCrypto helpers for encrypting and decrypting editor fragments.

### src/services/logger.ts
- Minimal console error helper.

### src-tauri/src/main.rs
- Path resolution and startup checks.
- IPC command registration.
- legacy notes-file protocol handler (compat).
- Menu wiring and events.
- Attachment import/read/delete commands.

### src-tauri/src/db.rs
- Schema creation and migrations.
- Repository methods with transactions.
- Search queries and OCR queries.
- Attachment CRUD helpers.

----------------------------------------------------------------
