# Evernote Import (in-app flow)

This document describes the current import flow used inside the app.
It is exhaustive by design, so another agent can re-implement it without
reading the code first.

The current import is **in-app** (no external scripts required).
Legacy scripts still exist in `scripts/`, but they are no longer the default.

-------------------------------------------------------------------------------
TABLE OF CONTENTS
-------------------------------------------------------------------------------

1. Summary
2. Source data inputs
3. Scan phase (validation + summary)
4. Import phase (staged)
5. Asset handling rules
6. Tags and hierarchy
7. Notes content conversion
8. Attachments and images
9. OCR behavior after import
10. Backups and restart
11. Error handling + report
12. Legacy scripts (optional)

-------------------------------------------------------------------------------
1. SUMMARY
-------------------------------------------------------------------------------

The import flow reads the **Evernote v10 local data folder** and converts it
directly into Notes Classic storage. The app:

- rebuilds stacks and notebooks,
- rebuilds notes HTML content,
- rebuilds tags + note-tag assignments,
- copies attachments and images to `data/files`,
- stores Evernote metadata into `notes.meta`,
- and enqueues OCR indexing for imported images.

The import runs inside the UI (modal dialog). It is staged with progress per
step, and it requires a **restart** after completion.

-------------------------------------------------------------------------------
2. SOURCE DATA INPUTS
-------------------------------------------------------------------------------

The user selects the **Evernote local data folder** (v10 format).
The import expects the following structure:

Required:
- `RemoteGraph.sql` (Evernote SQLite database)
- `internal_rteDoc/` (RTE content blobs)

Optional (assets):
- `resource-cache/` with `user*` subfolders

Typical layout:

```
<EvernoteDataRoot>/
  RemoteGraph.sql
  internal_rteDoc/
    000/123/abc...dat
  resource-cache/
    user1/
      <noteId>/<dataHash>
    user2/
      <noteId>/<dataHash>
```

The scan phase verifies that the database and RTE directory exist and collects
resource roots under `resource-cache/user*`.

-------------------------------------------------------------------------------
3. SCAN PHASE (validation + summary)
-------------------------------------------------------------------------------

The scan phase is executed when the user clicks **Scan** in the import dialog.
It performs:

- Folder validation (RemoteGraph.sql + internal_rteDoc present).
- Database open (sql.js) and table presence checks.
- Counts:
  - notes
  - notebooks
  - stacks
  - tags
  - note_tags
  - attachments
  - images
- Asset size totals
- Missing RTE file count

The scan result is shown in the modal summary and used to enable the Import
button.

-------------------------------------------------------------------------------
4. IMPORT PHASE (staged)
-------------------------------------------------------------------------------

The import runs with staged progress (each stage has its own progress bar):

1) **Read Evernote tables**
   - Load tables from RemoteGraph.sql.
   - Build lookup maps for stacks, notebooks, tags, and notes.

2) **Copy resources**
   - Copy files from resource-cache into `data/files`.
   - Each resource is given a new unique filename (no dedupe across notes).

3) **Decode notes**
   - Read RTE blobs from internal_rteDoc.
   - Convert ENML to HTML and normalize for Notes Classic.
   - Replace asset references with local `files/<hash>.<ext>` paths.

4) **Write database**
   - Insert stacks, notebooks, tags, notes, note_tags.
   - Insert attachments metadata.
   - Write notes_text rows (for FTS).

Each stage reports current/total counts and completion status.

-------------------------------------------------------------------------------
5. ASSET HANDLING RULES
-------------------------------------------------------------------------------

- All Evernote resources are copied into `data/files`.
- Filenames are unique per import item (no shared files across notes).
- Notes store `files/<hash>.<ext>` paths in HTML.
- content.ts later converts them to asset URLs for display.

-------------------------------------------------------------------------------
6. TAGS AND HIERARCHY
-------------------------------------------------------------------------------

- Tag hierarchy is preserved (parent-child).
- Note-tag assignments are rebuilt.
- Tags can be nested without limit.

-------------------------------------------------------------------------------
7. NOTES CONTENT CONVERSION
-------------------------------------------------------------------------------

- ENML content is decoded from RTE blobs.
- HTML is cleaned and normalized for Jodit.
- Callout/code blocks are preserved when present.
- Placeholder and trailing-break noise is removed.

-------------------------------------------------------------------------------
8. ATTACHMENTS AND IMAGES
-------------------------------------------------------------------------------

- Images are embedded as `<img>` with local `files/...` paths.
- Attachments are stored with metadata and rendered as attachment handles.
- Attachment payloads are stored in `data/files` and linked via DB rows.

-------------------------------------------------------------------------------
9. OCR BEHAVIOR AFTER IMPORT
-------------------------------------------------------------------------------

After import:

- `note_files` and `ocr_files` are backfilled from note HTML.
- OCR queue starts and processes pending images.
- OCR results are stored in `ocr_text` and indexed for search.

-------------------------------------------------------------------------------
10. BACKUPS AND RESTART
-------------------------------------------------------------------------------

Before import, the app creates a backup of the current storage under:

```
data/backups/evernote-YYYYMMDD-HHMMSS/
```

After import completes, the user must restart the app to load the new data.
The import UI provides a restart dialog.

-------------------------------------------------------------------------------
11. ERROR HANDLING + REPORT
-------------------------------------------------------------------------------

All errors are collected and written to a report JSON:

- report path is shown in the UI after import
- the report includes missing RTE files, decode errors, and resource copy errors

The import can finish with errors (partial import) or fail completely.

-------------------------------------------------------------------------------
12. LEGACY SCRIPTS (OPTIONAL)
-------------------------------------------------------------------------------

Legacy scripts still exist in `scripts/` for one-off imports:

- `scripts/evernote_export.js`
- `scripts/evernote_import_temp.js`

They are no longer required for normal operation, but can be used for
offline export or troubleshooting.
