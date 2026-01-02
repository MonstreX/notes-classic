# Architecture

This document is a full architectural description of the current application.
It is intentionally long and explicit. It mirrors real code paths and files.
All text is in English and matches the current code base.

## Table of contents

1. Goals and constraints
2. System map
3. Source tree and responsibilities
4. Layered architecture
5. Frontend runtime and UI modules
6. Controller and store flows
7. Service layer and content pipeline
8. Editor architecture and custom blocks
9. Search and OCR architecture
10. Database schema and migrations
11. Backend commands and menu wiring
12. Storage and asset protocol
13. Settings persistence
14. Error handling and logging
15. Performance considerations
16. Extension points and known risks
17. File-by-file notes (exhaustive)
18. Timing constants and retries

----------------------------------------------------------------

## 1) Goals and constraints

- Local-first, portable desktop app.
- No external services required.
- All data lives next to the executable.
- UI must be fast and deterministic.
- Editor must preserve complex HTML.
- Search must include OCR results.
- Attachments must be stored locally with original filenames.
- No React; vanilla DOM rendering.
- Keep IPC boundaries strict.

----------------------------------------------------------------

## 2) System map

The app is a layered system:

- UI layer (src/ui) renders DOM and handles user input.
- Controller layer (src/controllers) performs orchestration.
- State layer (src/state) stores in-memory state and subscriptions.
- Service layer (src/services) talks to backend and normalizes data.
- Backend layer (src-tauri/src) runs SQLite and filesystem access.
- Storage layer (data/, settings/) holds persistence.

The top level data flow is:

UI -> Controller -> Services -> Backend -> SQLite
SQLite -> Backend -> Services -> Controller -> UI

----------------------------------------------------------------

## 3) Source tree and responsibilities

Repository root:

- docs/              Documentation.
- src/               Frontend code (vanilla TS + SCSS).
- src-tauri/         Rust backend.
- data/              User data (notes.db, files, ocr).
- settings/          User settings (app.json).
- scripts/           Import scripts and utilities.

Frontend tree:

- src/main.ts        App entry, CSS imports, icon sprite injection.
- src/ui/            UI modules (DOM + events).
- src/controllers/   Orchestration and actions.
- src/services/      IPC wrappers and content utilities.
- src/state/         In-memory store and types.
- src/styles/        SCSS (base, layout, components).
- src/components/    Legacy React artifacts (unused).
- src/hooks/         Legacy React artifacts (unused).

Backend tree:

- src-tauri/src/main.rs  Tauri bootstrap and IPC commands.
- src-tauri/src/db.rs    Schema, migrations, repository queries.
- src-tauri/icons/       App icon.
- src-tauri/tauri.conf.json  Tauri configuration.

----------------------------------------------------------------

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

## 5) Frontend runtime and UI modules

### 5.1 Entry point (src/main.ts)

Startup steps:

1) Load Jodit CSS and highlight.js CSS.
2) Load global SCSS bundle.
3) Inject SVG sprite from assets/icons.svg.
4) Mount the app into #root using appShell.mountApp.

No other global side effects exist in main.ts.

### 5.2 App shell (src/ui/appShell.ts)

appShell is the UI coordinator.

Responsibilities:

- Build the full DOM layout (sidebar, list, editor).
- Mount child modules and provide handlers.
- Manage resize handles.
- Manage editor loading overlay.
- Manage empty state when no note is selected.
- Render on store updates.

DOM structure (simplified):

- root
  - .app-loading
  - .app-shell
    - .app-shell__sidebar
      - .app-shell__sidebar-inner
        - Search button
        - New Note button
        - .app-shell__sidebar-host (sidebar module)
      - .app-shell__resize-handle
    - .app-shell__list
      - .app-shell__list-host (notes list module)
      - .app-shell__resize-handle--list
    - .app-shell__editor
      - .app-shell__editor-shell
        - metaBar (mountMetaBar)
        - .app-shell__titlebar with title input
        - editor host (mountEditor)
        - tagsBar (mountTagsBar)
      - empty state (Select a note)

State-driven render logic:

- If isLoaded is false, show loading screen.
- Sidebar width and list width are applied from state.
- Title input mirrors state.title.
- Editor shell is hidden if no selected note.
- Empty state is shown if no selected note.
- Editor loading overlay is shown while loading or updating.

Editor update scheduling:

- scheduleEditorUpdate stores pending noteId and content.
- Uses a 0 ms timeout to batch updates.
- Cancels stale updates when selection changes.
- Avoids re-render when note and content match last state.

Resizing:

- Mousedown on resize handle sets flags.
- Mousemove adjusts sidebarWidth or listWidth via actions.
- Mouseup clears flags.

### 5.3 Sidebar module (src/ui/sidebar.ts)

Responsibilities:

- Render notebooks (stack + notebook) and tags tree.
- Handle selection, expand/collapse, and DnD.
- Provide action buttons (add notebook, add tag, add note).
- Keep scroll position stable on re-render.
- Maintain drag overlay and indicators.

Notebooks rendering:

- Top level is stack (parentId is null).
- Stack nodes can expand to show notebooks.
- Notebooks cannot contain children.
- All Notes entry is rendered above notebook tree.

Tags rendering:

- Unlimited depth.
- Tags sorted alphabetically by name at each level.
- Each tag row has Add and Expand actions.
- Tags section can be collapsed entirely.

Selection behavior:

- Clicking a stack toggles expansion and selects it.
- Clicking a notebook selects it.
- Clicking a tag selects it and optionally toggles if it has children.
- Clicking All Notes clears notebook and tag selection.

Expansion behavior:

- Expansion states are stored in state.expandedNotebooks and state.expandedTags.
- Animations are done using max-height and opacity.
- Tags section uses a similar animation for whole tree.

Drag and drop:

- Pointer down starts drag tracking.
- Requires a hold delay (180 ms) and movement threshold.
- Drag overlay shows only the item name.
- Notebook drag uses a green drop line.
- Tag drag uses highlight on target and on tags root.
- Drop targets are detected with elementFromPoint.

DnD constraints:

- Stacks can only be reordered at root.
- Notebooks can only be moved inside stacks.
- Tags can be reparented under any tag or root.

Scroll handling:

- Re-render keeps scrollTop.
- Tags section auto-scrolls after expanding to keep it visible.

### 5.4 Notes list module (src/ui/notesList.ts)

Responsibilities:

- Render header (title, count, actions).
- Render notes list in compact or detailed mode.
- Provide sort menu and view toggle.
- Support note DnD to notebooks.
- Support delete via Delete key.

Header:

- Title shows current notebook or tag, or Notes for All Notes.
- Count shows number of notes in list.
- Actions include filter, sort, and view buttons.

List view:

- Compact: single line with title and date.
- Detailed: title, excerpt, and date.
- Excerpt derived from content in controller.

Sort menu:

- Built dynamically when sort button is clicked.
- Items: Newest first, Oldest first, Name A-Z, Name Z-A.
- Clicking an item updates state via handlers.onSelectSort.
- Menu closes on outside click or on selection.

DnD notes:

- Pointer down on a note row starts drag tracking.
- Drag overlay shows note title only, or "N Notes" for group drag.
- Drop target is resolved in sidebar via elementFromPoint.
- Drop onto All Notes or a notebook updates note notebookId.
- Drop onto a tag adds that tag to the dragged notes.
- Drop onto Trash deletes (or trashes) the dragged notes.
- Drag uses custom overlay and highlight class on target.

Selection:

- Single click selects one note.
- Shift-click selects a range.
- Ctrl/Cmd-click toggles individual notes.
- Selected notes are tracked as selectedNoteIds in state.

### 5.5 Editor module (src/ui/editor.ts)

Editor module wraps Jodit and adds custom behavior.

Core configuration:

- readonly false by default.
- toolbarAdaptive false.
- statusbar false.
- minimal buttons set.
- allowResizeTags set for img and table.
- resizer enabled with size preview.
- extraPlugins: resizer, resize-cells.

Toolbar:

- bold, italic, underline
- ul, ol
- callout, todo, codeblock, encrypt
- link, image
- undo, redo

Custom controls:

- callout: wraps selected fragment into div.note-callout.
- todo: converts list to ul[data-en-todo=true], toggles li flags.
- codeblock: wraps selection into div.note-code with toolbar.
- encrypt: replaces selection with a password-protected secure block.
- attach: inserts a file attachment handle at the cursor.

Code block behavior:

- Toolbar contains language select and Copy button.
- highlight.js runs on each code block.
- Supports php, html, js, css, and auto.

Callout behavior:

- Enter inserts a paragraph inside the callout.
- Backspace at start removes callout.
- Delete at end removes callout.
- Arrow navigation exits at boundaries.
- Empty callout removes itself.

HR insertion:

- Typing --- at end of a line and pressing Enter inserts hr.
- Works outside callout/code blocks.

Links:

- Click on anchor opens in system browser via shell plugin.
- Prevents default navigation in editor.

Preview editor:

- Jodit with readonly true and empty toolbars.
- Used in search modal preview.

### 5.6 Meta bar (src/ui/metaBar.ts)

Displays context above editor:

- Stack icon and name.
- Notebook icon and name.
- Last edited timestamp from active note.

When no note is selected:

- Meta elements are hidden.
- Text is cleared.

### 5.7 Tags bar (src/ui/tagsBar.ts)

Responsibilities:

- Render tag chips for the active note.
- Provide input for adding tags.
- Provide suggestion dropdown.

Tag suggestions:

- Trigger after 2 characters.
- Case-insensitive, prefix match only.
- Excludes tags already assigned to the note.
- Enter selects active suggestion if present.
- Tab always adds typed value as new tag.

### 5.8 Search modal (src/ui/searchModal.ts)

Responsibilities:

- Render modal for text and OCR search.
- Handle search scope (current notebook vs everywhere).
- Show OCR indexing status.
- Render results and preview.

Search flow:

- User clicks Search button or presses Enter.
- tokenizeQuery splits input into tokens.
- buildSearchQuery builds FTS query with wildcards.
- searchNotes invoked via service.
- Results are capped to 100.
- First result is auto-selected for preview.

Result layout:

- Title on first line.
- Stack and notebook on second line.
- OCR match shows image icon.
- Open button opens note and closes modal.

Preview:

- Uses readonly Jodit.
- Content passes through toDisplayContent.
- Matches highlighted if content size is below threshold.

### 5.9 Context menus (src/ui/contextMenu.ts)

Responsibilities:

- Create right-click menus.
- Manage nested submenu for Move To.
- Close menus on outside click, scroll, resize, or Escape.

Menu types:

- Note menu: Delete, Move To submenu.
- Notebook menu: Delete.
- Tag menu: Delete.
- Notes group menu: "N Notes selected", Delete Notes, Move To submenu.
- Trash group menu: "N Notes selected", Restore Notes, Delete Permanently.

### 5.10 Dialogs (src/ui/dialogs.ts)

Responsibilities:

- Create modal overlays for create notebook/tag and confirmations.
- Provide password prompt for encrypted blocks.
- Validate input.
- Handle Enter and Escape.
- Remove DOM on completion.

Dialog types:

- Create stack or notebook.
- Create tag (root or nested).
- Confirmation for delete.

----------------------------------------------------------------

## 6) Controller and store flows

### 6.1 Controller (src/controllers/appController.ts)

Key helpers:

- sortNotes: sorts by title or updatedAt, stable by id.
- stripTags and buildExcerpt: removes HTML for list previews.
- normalizeTagName: trims input.
- findTagByName: case-insensitive lookup.

fetchData:

- Loads notebooks, notes, and counts in parallel.
- Picks notes source based on selected tag or notebook.
- Builds excerpts for notes list.
- Applies sorting based on state.
- Ensures selected note exists in new list.
- Sets isNoteLoading when selection changes.
- Triggers loadSelectedNote if needed.

loadSelectedNote:

- Uses noteLoadToken to prevent stale updates.
- Fetches full note content.
- Normalizes ENML and file URLs (notes-file -> files).
- Converts to display content using asset protocol.
- Loads tags for selected note.
- Updates activeNote, title, content, and noteTags.
- Clears isNoteLoading when done.

Autosave:

- Debounced by 1 second.
- Writes only if title or content changed.
- Converts content back to storage form.
- Updates notes list in store with updatedAt and excerpt.

Actions map:

- setTitle, setContent
- selectNote, setNoteSelection, selectNotebook, selectTag
- toggleNotebook, toggleTag, toggleTagsSection
- setSidebarWidth, setListWidth
- setNotesListView, setNotesSort
- addTagToNote, removeTagFromNote
- addTagToNotes
- createTag, deleteTag, moveTag
- createNote, createNoteInNotebook, deleteNote, deleteNotes
- createNotebook, deleteNotebook
- moveNoteToNotebook, moveNotesToNotebook, moveNotebookByDrag
- restoreNote, restoreNotes, restoreAllTrash

Selection safeguards:

- deleteNote tries to select a valid note after deletion.
- If no notes remain, clears active note and editor state.
- When moving a note away from current notebook, selection is adjusted.

Settings sync:

- appStore.subscribe persists settings on relevant changes.
- Selection changes trigger fetchData.
- Notes list view changes notify backend to update menu checks.

### 6.2 Store (src/state/store.ts)

State structure:

- notebooks: Notebook[]
- notes: NoteListItem[]
- noteCounts: Map<notebookId, count>
- totalNotes: number
- notesListView: detailed or compact
- notesSortBy: updated or title
- notesSortDir: asc or desc
- tags: Tag[]
- noteTags: Tag[] for selected note
- selectedNotebookId: number or null
- selectedTagId: number or null
- selectedNoteId: number or null
- selectedNoteIds: Set<number>
- selectedTrash: boolean
- expandedNotebooks: Set<number>
- expandedTags: Set<number>
- tagsSectionExpanded: boolean
- sidebarWidth: number
- listWidth: number
- trashedCount: number
- deleteToTrash: boolean
- title: string
- content: string
- activeNote: NoteDetail or null
- isLoaded: boolean
- isNoteLoading: boolean

Update semantics:

- setState merges partial object.
- update uses a cloned draft and then replaces state.
- notify triggers all subscribed listeners.

----------------------------------------------------------------

## 7) Service layer and content pipeline

### 7.1 notes service (src/services/notes.ts)

IPC wrappers:

- getNotebooks
- getNotes
- getTrashedNotes
- getNotesByTag
- searchNotes
- getNote
- getNoteCounts
- createNote
- updateNote
- deleteNote
- trashNote
- restoreNote
- restoreAllNotes
- moveNote
- createNotebook
- deleteNotebook
- moveNotebook
- setNotesListView

Each service maps to a Rust command.

### 7.2 tags service (src/services/tags.ts)

IPC wrappers:

- getTags
- getNoteTags
- createTag
- addNoteTag
- removeNoteTag
- deleteTag
- updateTagParent

### 7.3 content service (src/services/content.ts)

Purpose:

- Normalize content on load.
- Map files/ URLs to asset protocol URLs.
- Restore files/ URLs on save.

Key functions:

- normalizeEnmlContent: en-note to div, br cleanup.
- normalizeFileLinks: removes legacy notes-file prefixes.
- toDisplayContent: resolves files/ to asset URLs.
- toStorageContent: restores files/ URLs from asset URLs.

Caching:

- imageSrcMap maps asset URLs to files/ URLs for round-trip.
- assetUrlCache memoizes convertFileSrc results.

### 7.4 settings service (src/services/settings.ts)

Storage:

- settings/app.json via get_settings and set_settings.
- debounce of 200 ms for frequent UI updates.

Migrating legacy storage:

- reads old localStorage key notes_classic_v10_stable.
- migrates data once and deletes legacy key.

### 7.5 OCR service (src/services/ocr.ts)

Pipeline:

- Uses tesseract.js createWorker.
- Loads languages from data/ocr/tessdata.
- Uses convertFileSrc for image paths.
- Processes files in batches with retries.

Worker lifecycle:

- Worker is created lazily.
- Worker is reset on failure.
- withTimeout protects against hung worker.

Queue control:

- get_ocr_pending_files fetches pending work.
- mark_ocr_failed reduces attempts_left.
- upsert_ocr_text writes results.
- get_ocr_stats reports total/done/pending.

----------------------------------------------------------------

## 8) Editor architecture and custom blocks

Editor behaviors are defined in src/ui/editor.ts.

### 8.1 Jodit configuration

Settings:

- readonly false (default).
- toolbarAdaptive false (fixed toolbar).
- statusbar false.
- spellcheck true.
- no word or char counters.
- enter uses P tags.
- minimal toolbar buttons.

Resize support:

- allowResizeTags includes img and table.
- resizer plugin enabled.
- resize-cells plugin enabled.
- tableAllowCellResize true.

### 8.2 Callout block

Creation:

- User selects text and clicks Callout button.
- Selected fragment is wrapped in div.note-callout.
- Cursor moves after the callout.

Editing rules:

- Enter inserts a new paragraph in the callout.
- Backspace at start removes callout.
- Delete at end removes callout.
- Arrow up/down exits callout at boundaries.
- Empty callout is removed on keyup/change.

### 8.3 Code block

Creation:

- User selects text and clicks Code Block.
- Text is extracted with line breaks preserved.
- Wraps content in div.note-code with toolbar.

Toolbar:

- Language select (auto, php, html, js, css).
- Copy button.

Highlighting:

- highlight.js is used to highlight code.
- auto mode tries php, html, javascript, css.
- highlight is re-run on change and after set value.

Editing rules:

- Enter inserts literal newline.
- Code block is removed if empty.

### 8.4 TODO list

Creation:

- Button converts current list to ul[data-en-todo].
- Each li gets data-en-checked if missing.

Interaction:

- Clicking on list item toggles data-en-checked.
- Checkboxes are styled via CSS using ::before.

### 8.5 HR insertion

Behavior:

- Typing --- and pressing Enter outside blocks inserts hr.
- The --- text is removed and replaced by hr + paragraph.

### 8.6 Link handling

Behavior:

- Click on a link opens system browser via shell plugin.
- Default navigation is prevented.

### 8.7 Preview editor

Behavior:

- Readonly Jodit instance.
- No toolbar and no status bar.
- Used for search modal preview.

### 8.8 Encrypted block

Creation:

- User selects HTML and clicks Encrypt (ENC).
- Selection is serialized to HTML.
- Images are inlined as data URLs before encryption.
- Attachment handles are replaced with embedded base64 payloads before encryption.
- The resulting HTML is encrypted with AES-GCM.
- The encrypted payload is stored in a div.note-secure data attributes.
- The visible handle shows a lock icon and dots.

Interaction:

- Clicking a secure block prompts for the password.
- If the password is valid, a modal viewer opens with decrypted HTML.
- The viewer is read-only. It is for preview only.
- Embedded attachments in the viewer allow View and Download actions only.

Storage:

- The encrypted payload is stored inline as data attributes.
- No plaintext is kept in the note content.

Remove encryption:

- Right-click a secure handle and choose "Remove encryption".
- The user is prompted for the password.
- Decrypted HTML is restored into the note and the secure block is removed.
- Data URL images are re-stored into note files and src is rewritten to asset URLs.
- Embedded attachments are stored as real attachments and handles are rebuilt.

### 8.9 Attachments

Creation:

- Attach via toolbar button (ATT) or drag-and-drop.
- Files are copied to data/files/attachments/<id>/original_name.
- Attachment metadata is stored in the attachments table.
- Editor inserts a div.note-attachment handle with filename and size.

Why attachments are separate:

- Inline images are part of note HTML and flow through note_files/ocr_files for
  OCR indexing.
- Attachments are explicit file entities with metadata and actions (download,
  view, delete). They do not participate in OCR indexing.

File lifecycle:

- Attachment handles embed data-attachment-id for tracking.
- When a handle is removed from note content, the attachment row and file are
  deleted on the next note update.

Interaction:

- Download: save file to chosen location.
- View: open preview for text files only.
- Delete: confirm and remove attachment + handle.

Storage:

- File data lives in data/files/attachments.
- DB stores local_path, filename, mime, and size.

Limitations:

- Preview is text-only.
- Trash is implemented for notes (restore single/all).

----------------------------------------------------------------

## 9) Search and OCR architecture

### 9.1 Search data sources

- notes_text (plain text) is indexed by notes_fts.
- ocr_text is indexed by ocr_fts.
- search_notes merges both sources and flags ocr matches.

### 9.2 Search query building

Tokenization:

- input is split by whitespace.
- quotes are stripped.
- tokens containing numbers and dashes are split further.

FTS query:

- each token is sanitized to letters, digits, underscore, dash.
- each token gets a trailing wildcard.
- tokens are joined with AND.

### 9.3 Search rendering

Results list:

- Shows note title and scope path.
- OCR match icon indicates an image hit.
- Open button navigates to the note.

Preview:

- Loads full note via getNote.
- Converts to display content.
- Highlights tokens with span.search-modal__highlight.
- Uses readonly Jodit to match editor rendering.

### 9.4 OCR indexing

Data flow:

- ocr_files rows are created by syncing note content.
- Each file is processed by the OCR worker.
- OCR text is inserted into ocr_text with hash and updated_at.
- FTS triggers update ocr_fts.

Retries:

- Each file has attempts_left (default 3).
- Failures reduce attempts_left.
- Files with attempts_left == 0 stop retrying.

Supported image types:

- OCR is queued only for raster formats (png, jpg/jpeg, gif, webp, bmp).
- Vector images like svg are skipped and marked as unsupported.

Status:

- get_ocr_stats returns total, done, pending.
- Search modal shows status in header.

----------------------------------------------------------------

## 10) Database schema and migrations

### 10.1 Schema versioning

- schema_version table stores a single integer.
- version 0 means new DB with no tables.
- version 3 is the current schema.

### 10.2 Schema creation

create_schema_v3 creates all tables and triggers.
It is called during init_db to ensure existence.

### 10.3 Migrations

migrate_to_v3 is additive:

- Adds missing columns for reserved fields.
- Ensures OCR attempts_left and last_error exist.
- Does not drop columns to preserve data.

### 10.4 Normalization

During init_db:

- Notebooks are normalized to stack/notebook model.
- Orphan or nested notebooks are reparented to root stack.
- sort_order is recalculated when structure changes.

### 10.5 Search index backfill

notes_text is backfilled if its count is below notes count.

### 10.6 Note files backfill

backfill_note_files_and_ocr scans existing note HTML:

- Extracts files/ image sources (legacy notes-file is normalized).
- Creates entries in ocr_files and note_files.

Note file lifecycle:

- Images are stored under data/files/<unique_hash>.<ext>.
- The hash used for file paths is unique per insert, not a global dedupe key.
- On update_note, note_files are resynced from HTML and orphaned ocr_files
  entries are removed.
- Orphaned files on disk are deleted after a successful commit.
- Keeps OCR queue accurate for existing content.

----------------------------------------------------------------

## 11) Backend commands and menu wiring

### 11.1 Command list

Each frontend service maps to one of these commands:

- get_notebooks
- create_notebook
- delete_notebook
- move_notebook
- move_note
- get_notes
- get_notes_by_tag
- search_notes
- get_note
- get_note_counts
- get_data_dir
- upsert_note
- delete_note
- get_ocr_pending_files
- upsert_ocr_text
- mark_ocr_failed
- get_ocr_stats
- get_tags
- get_note_tags
- create_tag
- add_note_tag
- remove_note_tag
- delete_tag
- update_tag_parent
- set_notes_list_view
- get_settings
- set_settings

### 11.2 Menu events

Menu items emit events for:

- Notes list view switch (detailed/compact).
- Import Evernote placeholder.

UI listens with tauri event API and updates store.

----------------------------------------------------------------

## 12) Storage and asset protocol

Storage layout:

- data/notes.db
- data/files/*
- data/ocr/tessdata/*
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
- Changing storage path copies data and requires restart.

----------------------------------------------------------------

## 13) Settings persistence

Stored fields:

- sidebarWidth
- listWidth
- selectedNotebookId
- selectedTagId
- selectedNoteId
- expandedNotebooks
- expandedTags
- tagsSectionExpanded
- notesListView
- notesSortBy
- notesSortDir
- deleteToTrash
- dataDir (optional override for storage location)

File format:

- JSON, pretty-printed, stored in settings/app.json.

Legacy migration:

- Old localStorage key is migrated on first run.

----------------------------------------------------------------

## 14) Error handling and logging

Frontend:

- logError is used for structured console errors.
- Many operations guard against stale state.
- OCR errors are logged and retried.

Backend:

- Errors are returned as strings in Result.
- Storage errors show a dialog and abort startup.

----------------------------------------------------------------

## 15) Performance considerations

Notes list:

- Backend returns substr(content, 1, 4000) for list view.
- Excerpts are derived by stripping HTML in controller.
- Sorting is done in memory for the current list.

Editor:

- Updates are scheduled to avoid continuous sync writes.
- Editor content updates are avoided if unchanged.

Search:

- FTS queries are used for text and OCR.
- Highlighting is disabled for extremely large HTML.

OCR:

- Batch size is small to keep UI responsive.
- Worker is restarted on failures.

----------------------------------------------------------------

## 16) Extension points and known risks

Extension points:

- attachments table for file attachments.
- sync fields on notes and notebooks.
- meta JSON for per-note metadata.
- OCR languages can be extended via tessdata.

Known risks:

- OCR runs in renderer and can consume CPU.
- Tag tree re-renders fully on tag changes.
- Editor custom blocks depend on DOM state and can be fragile.

----------------------------------------------------------------

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

## 18) Timing constants and retries

The code base uses a small set of timing constants that affect UX:

- Drag hold delay: `src/ui/dragConfig.ts` -> `DRAG_HOLD_MS`
- Drag distance threshold: `src/ui/dragConfig.ts` -> `DRAG_START_PX`
- Editor update scheduling: `src/ui/editorScheduler.ts` uses setTimeout(0)
- Autosave debounce: `src/controllers/appController.ts` -> 1000 ms
- Settings debounce: `src/services/settings.ts` -> 200 ms
- OCR queue:
  - `src/services/ocr.ts` -> `BATCH_SIZE`, `IDLE_DELAY_MS`, `RETRY_DELAY_MS`
  - worker timeout uses `withTimeout` (30s start, 60s recognize)

Retry strategy:

- OCR uses `attempts_left` in `ocr_files` (default 3).
- Each failure decrements attempts_left.
- Files with attempts_left == 0 are skipped by the queue.

----------------------------------------------------------------

End of document.
