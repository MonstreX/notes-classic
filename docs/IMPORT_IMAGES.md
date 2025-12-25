# Import Images: Why They Disappeared and Fixes

Date: 2025-12-25

## Symptom
- Notes imported from Evernote opened with empty content or only `ProseMirror-trailingBreak` paragraphs.
- Images were present in the database (`content` field) but did not render in the editor.

## Root Causes
1) ENML wrapper and structure
- Imported content still used ENML tags (`<en-note>`, `<en-media>`, `<br></br>`).
- Tiptap does not accept ENML or nested/invalid HTML, so it dropped the content.

2) Image loading
- `notes-file://` URLs are not supported by the Vite dev server, and `asset.localhost` via `convertFileSrc` caused invalid HTTPS certificate errors.
- Tiptap also filtered out images if they were treated as inline-only or base64 was not allowed.

## Fixes Applied
1) Convert ENML to normal HTML at import time
- `scripts/evernote_import_temp.js` now normalizes ENML:
  - `<en-note>` -> `<div>`
  - `<br></br>` -> `<br>`
  - `<en-todo>` -> `<input type="checkbox" disabled>`
  - `<div>` -> `<p>` with cleanup of nested `<p>` wrappers
- Imported content is stored as normal HTML, not ENML.

2) Stabilize image URLs for the app
- Imported images are stored as `notes-file://files/<hash>.<ext>`.
- Paths are independent of notebook location and survive moves.

3) Tiptap image configuration
- `@tiptap/extension-image` configured as a block node and base64 enabled:
  - `inline: false`
  - `allowBase64: true`

## Result
- Imported notes display full content and images correctly.
- Note list loading is fast because list queries now load only short content previews.

## Related Files
- `scripts/evernote_import_temp.js`
- `src/components/Editor.tsx`
- `src-tauri/src/db.rs`
- `src-tauri/src/main.rs`
- `src/App.tsx`
