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
