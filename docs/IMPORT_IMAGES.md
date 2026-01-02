# Import Images: Why They Disappeared and Fixes

Date: 2025-12-25

## Symptom
- Imported notes opened with empty content or only placeholder paragraphs.
- Images existed in the database but did not render in the editor.

## Root Causes
1) **ENML content**
- Imported content used Evernote ENML (`<en-note>`, `<en-media>`, invalid `<br></br>`), which Jodit cannot render.

2) **Image URLs**
- Raw file URLs are not loadable by the browser context.
- The UI must translate `files/...` paths to the Tauri asset protocol via `convertFileSrc`.

## Fixes Applied
1) **Normalize ENML to HTML** during import
- `<en-note>` -> `<div>`
- `<br></br>` -> `<br>`
- Minimal cleanup so the editor receives standard HTML

2) **Keep stable resource URLs**
- Note content stores resources as `files/<hash>.<ext>`
- Display layer converts them to asset URLs using `convertFileSrc`

3) **Editor compatibility**
- Jodit is configured for inline images and block content without stripping elements.

## Result
- Imported notes display full content and images correctly.
- Image paths remain stable even if notes move between notebooks.

## Related Files
- `scripts/evernote_import_temp.js`
- `src/services/content.ts`
- `src/services/notes.ts`
- `src-tauri/src/db.rs`
- `src-tauri/src/main.rs`
