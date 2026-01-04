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
- Loads languages from resources/ocr/tessdata (resolved via get_resource_dir).
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
