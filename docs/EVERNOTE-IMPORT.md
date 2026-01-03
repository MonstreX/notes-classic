# Evernote Import (current pipeline)

This document describes the current, working import pipeline for Evernote
data into Notes Classic. It is intended to be **exhaustive** so another agent
can rebuild the flow end-to-end without reading the code first.

The pipeline is **two-stage**:

1) **Export stage** (Evernote -> intermediate JSON + assets folder).
2) **Import stage** (intermediate JSON + assets -> Notes Classic DB + files).

All scripts are in `scripts/` and can be run directly with Node.js.

-------------------------------------------------------------------------------
TABLE OF CONTENTS
-------------------------------------------------------------------------------

1. Summary
2. Source data inputs
3. Export stage: scripts/evernote_export.js
4. Export JSON structure (full schema)
5. Export assets layout
6. Import stage: scripts/evernote_import_temp.js
7. Import DB schema (what is created)
8. Import mappings (Evernote -> Notes Classic)
9. Content normalization (ENML -> HTML)
10. Asset rewrite rules
11. Tags and hierarchies
12. Attachments and images
13. OCR integration after import
14. Expected runtime effects in the app
15. Troubleshooting and validation
16. Common pitfalls and edge cases
17. Suggested verification checklist

-------------------------------------------------------------------------------
1. SUMMARY
-------------------------------------------------------------------------------

The import is done via a **temporary export JSON** plus a **copied assets**
directory. The export JSON contains raw Evernote metadata plus ENML content
decoded from Evernote RTE files. The import uses that JSON to:

- rebuild notebook stacks and notebooks,
- rebuild notes content (HTML, cleaned),
- rebuild tags and note-tag assignments,
- rebuild attachments metadata,
- copy assets to the app data `files/` directory,
- and store Evernote-specific metadata into the `notes.meta` JSON column.

Once imported, the normal app startup will scan notes for embedded images and
enqueue OCR indexing if needed.

-------------------------------------------------------------------------------
2. SOURCE DATA INPUTS
-------------------------------------------------------------------------------

You need the **current Evernote data** (Evernote v10 style):

Required:
- Evernote database file: `RemoteGraph.sql`
- RTE (rich text) directory: `internal_rteDoc`

Optional (for assets):
- Resource cache directory (contains images and files):
  Example path: `resource-cache` (with `user*` subfolders)

Typical source layout from Evernote:

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

Notes:
- Evernote note content is stored in **RTE files** as Yjs updates
  (not as plain HTML in SQL).
- RTE file path is derived from the note id:
  - `subA = noteId.slice(0, 3)`
  - `subB = noteId.slice(-3)`
  - file path: `<rteRoot>/<subA>/<subB>/<noteId>.dat`
- Attachments and images are stored in the resource cache:
  - `resource-cache/<user>/<noteId>/<dataHash>`

-------------------------------------------------------------------------------
3. EXPORT STAGE: scripts/evernote_export.js
-------------------------------------------------------------------------------

Command:

```
node scripts/evernote_export.js \
  --db <path-to-RemoteGraph.sql> \
  --rte <path-to-internal_rteDoc> \
  --out <path-to-export.json> \
  --resources <path-to-resource-cache> \
  --assets <path-to-assets-dir>
```

Optional:
- `--limit N` to export only first N notes.
- `--resources` + `--assets` must be used together.

What it does:

1) Loads `RemoteGraph.sql` with `sql.js`.
2) Checks that tables `Nodes_Note` and `Nodes_Notebook` exist.
3) Reads:
   - `Nodes_Notebook` -> notebooks
   - `Nodes_Note` -> notes
   - `Nodes_Tag` -> tags (if exists)
   - `NoteTag` -> note-tag join (if exists)
   - `Attachment` -> attachments (if exists)
4) Decodes RTE files with Yjs to extract:
   - title
   - ENML (content)
   - custom note styles
   - meta map
5) Copies attachment binaries from resource cache into assets folder.
6) Rewrites ENML `<en-media hash="...">` into `<img ...>` with `src` pointing
   to the assets directory.
7) Writes a single export JSON file with all data.

Important behaviors:

- Stack id normalization:
  Evernote stack ids can be prefixed with `Stack:`.
  The script strips `Stack:` so a stack id is a clean name.

- Assets directory layout:
  Each file is placed under `assets/<hashPrefix>/<hash>.<ext>`.
  `hashPrefix` = first 2 hex chars of hash.

- Image extension:
  Determined by attachment filename extension or by MIME map:
  - `image/jpeg` -> `jpg`
  - `image/png`  -> `png`
  - `image/gif`  -> `gif`
  - `image/webp` -> `webp`
  - `image/svg+xml` -> `svg`
  - `application/pdf` -> `pdf`
  - `text/plain` -> `txt`
  - `application/json` -> `json`

- ENML rewrite:
  All `<en-media hash="...">` placeholders are replaced with `<img>`.
  The resulting `src` uses:
  - `assetsBase` when provided (relative path from JSON to assets dir),
  - or raw `relPath` when assetsBase is null.

-------------------------------------------------------------------------------
4. EXPORT JSON STRUCTURE (FULL SCHEMA)
-------------------------------------------------------------------------------

Top-level JSON:

```
{
  "meta": { ... },
  "stacks": [ ... ],
  "notebooks": [ ... ],
  "tags": [ ... ],
  "notes": [ ... ],
  "attachments": [ ... ],
  "noteTags": [ ... ],
  "missingRte": [ ... ],
  "decodeErrors": [ ... ]
}
```

4.1 meta

Fields:
- `exportedAt` (string, ISO date)
- `dbPath` (string)
- `rteRoot` (string)
- `resourcesRoot` (string or null, multiple roots joined by `;`)
- `assetsDir` (string or null)
- `assetsBase` (string or null) -> relative path from JSON file to assets dir
- `noteCount` (number)
- `notebookCount` (number)
- `stackCount` (number)
- `attachmentCount` (number)
- `tagCount` (number)
- `noteTagCount` (number)
- `missingRteCount` (number)
- `decodeErrorCount` (number)

4.2 stacks

Array of:

```
{
  "id": "StackNameOrId",
  "name": "StackNameOrId"
}
```

4.3 notebooks

Raw rows from `Nodes_Notebook`. This includes Evernote fields as-is.

Important fields:
- `id` (Evernote notebook id)
- `label` / `name` / `title` (display name)
- `personal_Stack_id` (stack membership, may be `Stack:...`)

4.4 tags

Raw rows from `Nodes_Tag` (if present).

Important fields:
- `id`
- `name` or `label`
- `parentId` / `parent_Tag_id`

4.5 noteTags

Raw rows from `NoteTag` (if present).

Fields:
- `note_id` / `Note_id` / `noteId`
- `tag_id` / `Tag_id` / `tagId`

4.6 attachments

Array of:

```
{
  "attachmentFields": { ...raw Attachment row... },
  "noteId": "<EvernoteNoteId>" | null,
  "dataHash": "<hex hash>" | null,
  "filename": "original.ext" | null,
  "mime": "image/png" | null,
  "dataSize": 12345 | null,
  "localFile": {
    "exists": true | false,
    "sourcePath": "...",
    "relPath": "ab/abcdef...png" | null,
    "absPath": "/abs/path/to/assets/ab/abcdef.png" | null
  } | null
}
```

Notes:
- `localFile.relPath` is relative to the assets directory.
- `dataHash` is the key used for linking `en-media` to real files.

4.7 notes

Array of:

```
{
  "id": "<EvernoteNoteId>",
  "title": "Note title" | null,
  "enml": "<raw ENML>" | null,
  "enmlResolved": "<ENML with <en-media> rewritten to <img>>" | null,
  "customNoteStyles": { ... } | null,
  "meta": { ... } | null,
  "noteFields": { ...raw Nodes_Note row... },
  "notebookId": "<EvernoteNotebookId>" | null,
  "attachments": [
     { "dataHash": "...", "filename": "...", "mime": "...", "dataSize": 1234, "relPath": "ab/..." }
  ]
}
```

4.8 missingRte / decodeErrors

missingRte:
```
{ "id": "<noteId>", "path": "<expected rte path>" }
```

decodeErrors:
```
{ "id": "<noteId>", "path": "<rte path>", "error": "<string>" }
```

-------------------------------------------------------------------------------
5. EXPORT ASSETS LAYOUT
-------------------------------------------------------------------------------

The export copies attachment binaries into the assets directory.

Layout example:

```
export_assets/
  3f/
    3f58...a9.png
  ab/
    ab0e...42.pdf
```

Rules:
- First two hex chars of data hash become the folder.
- The file name is the full hash plus extension if resolved.
- The same `dataHash` is referenced from `enmlResolved` via `data-en-hash`.

-------------------------------------------------------------------------------
6. IMPORT STAGE: scripts/evernote_import_temp.js
-------------------------------------------------------------------------------

Command:

```
node scripts/evernote_import_temp.js \
  --input <path-to-export.json> \
  --assets <path-to-assets-dir> \
  --data <path-to-notes-classic-data>
```

If `--data` is omitted, it uses `./data`.

What it does:

1) Creates or opens `notes.db` inside `dataDir`.
2) Creates tables if they do not exist.
3) Clears tables (full reimport) inside a transaction.
4) Inserts stacks and notebooks.
5) Inserts notes (content normalized).
6) Inserts attachments (metadata only).
7) Inserts tags and note_tags relations.
8) Copies assets dir into `dataDir/files`.

Important behaviors:

- **Full replace** import:
  The script deletes all existing data before inserting new records.
  This is an initial import, not a merge.

- **Content hash**:
  SHA-256 of HTML content is stored in `notes.content_hash`.

- **Content size**:
  Byte size is stored in `notes.content_size`.

- **Evernote metadata**:
  Original Evernote fields are stored inside `notes.meta` under `evernote`.

-------------------------------------------------------------------------------
7. IMPORT DB SCHEMA (WHAT IS CREATED)
-------------------------------------------------------------------------------

Tables created by the import script (if missing):

7.1 notebooks

```
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  parent_id INTEGER,
  notebook_type TEXT NOT NULL DEFAULT 'stack',
  sort_order INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  FOREIGN KEY(parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
);
```

7.2 notes

```
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_status INTEGER DEFAULT 0,
  remote_id TEXT,
  notebook_id INTEGER,
  external_id TEXT,
  meta TEXT,
  content_hash TEXT,
  content_size INTEGER,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
);
```

7.3 tags

```
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  external_id TEXT,
  FOREIGN KEY(parent_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_tags_parent_name ON tags(parent_id, name);
```

7.4 note_tags

```
CREATE TABLE note_tags (
  note_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(note_id, tag_id),
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

7.5 attachments

```
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  external_id TEXT,
  hash TEXT,
  filename TEXT,
  mime TEXT,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  local_path TEXT,
  source_url TEXT,
  is_attachment INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX idx_attachments_note_id ON attachments(note_id);
```

-------------------------------------------------------------------------------
8. IMPORT MAPPINGS (EVERNOTE -> NOTES CLASSIC)
-------------------------------------------------------------------------------

8.1 Stacks and notebooks

Evernote stacks are mapped to:
- `notebooks` rows with `notebook_type = "stack"`.
- `parent_id = NULL`.

Evernote notebooks are mapped to:
- `notebooks` rows with `notebook_type = "notebook"`.
- `parent_id` points to the stack row.

If a notebook has no stack:
- The script creates a special stack "Unsorted".

Mapping rules:

```
stackId = normalizeStackId(nb.personal_Stack_id)
parentId = stackIdMap[stackId] or stackIdMap["__unsorted__"]
```

Notebook name resolution:
- `nb.label` or `nb.name` or `nb.title` or `nb.id`.

8.2 Notes

Evernote note fields used:

- `note.noteFields` (raw SQL row from `Nodes_Note`)
- `note.title` from RTE doc (preferred)
- `note.notebookId` or `note.noteFields.parent_Notebook_id`

Mapping rules:

```
title = note.title || fields.title || fields.label || "Untitled"
created_at = normalizeTimestamp(fields.created || fields.createdAt || fields.creationDate)
updated_at = normalizeTimestamp(fields.updated || fields.updatedAt || fields.updateDate)
notebook_id = notebookIdMap[note.notebookId || fields.parent_Notebook_id]
```

8.3 Content and meta

Content:
- `note.enmlResolved` preferred, then `note.enml`.
- Then:
  - `rewriteAssetPaths` to turn assetsBase paths into `notes-file://files/...`
  - `normalizeEnmlToHtml` to turn ENML into HTML.

Meta:

```
meta = {
  evernote: {
    noteFields: fields,
    customNoteStyles: note.customNoteStyles,
    rteMeta: note.meta,
    enml: note.enml,
    enmlResolved: note.enmlResolved,
    attachments: note.attachments
  }
}
```

8.4 Attachments

Attachments are imported into the `attachments` table only.
The file binary is copied to `dataDir/files`.

Mapping rules:

```
note_id = noteIdMap[attachment.noteId or fields.parent_Note_id]
hash = attachment.dataHash or fields.dataHash
filename = attachment.filename or fields.filename
mime = attachment.mime or fields.mime
size = attachment.dataSize or fields.dataSize
width = fields.width or fields.imageWidth
height = fields.height or fields.imageHeight
local_path = "files/<relPath>" if relPath exists
source_url = fields.sourceUrl or fields.sourceURL or fields.source_url
is_attachment = fields.isAttachment or fields.is_attachment or 1
```

8.5 Tags and note-tags

Tags are inserted in two passes:
1) Roots (`parentId` is null)
2) Children (resolve parent after roots created)

Note-tag mapping uses external ids to map to local ids.

-------------------------------------------------------------------------------
9. CONTENT NORMALIZATION (ENML -> HTML)
-------------------------------------------------------------------------------

The `normalizeEnmlToHtml()` function performs the following:

- Convert `<en-note>` to `<div>`, and close tags accordingly.
- Replace `<br></br>` with `<br>`.
- Convert `<en-todo checked="true" />` into `<input type="checkbox" checked disabled>`.
- Convert `<div ... --en-codeblock:true ...>` into `<div class="note-callout">`.
- Replace all `<div>` with `<p>` (and close tags).
- Remove nested `<p>` duplication.
- Remove empty paragraphs and `<p><br></p>` placeholders.

The goal is to produce **Jodit-compatible HTML** with as little extra
structure as possible.

Important: it is a **lossy** transformation, but produces stable display.

-------------------------------------------------------------------------------
10. ASSET REWRITE RULES
-------------------------------------------------------------------------------

The export uses `rewriteEnml()`:

```
<en-media hash="HASH" ... />
  ->
<img data-en-hash="HASH" src="assetsBase/<hashPrefix>/<hash>.<ext>" />
```

The import uses `rewriteAssetPaths()`:

- If `assetsBase` is defined in JSON meta:
  - Replace `src="assetsBase/...` with `src="notes-file://files/..."`.
- This ensures stored content uses **relative storage paths**.

After import, the UI uses `src/services/content.ts` to:

- Convert `notes-file://files/...` to Tauri asset URLs via `convertFileSrc`.
- Resolve `files/...` paths in the same manner.

Key principle:
- **Stored HTML uses relative storage references.**
- **UI converts to absolute asset URLs for display.**

-------------------------------------------------------------------------------
11. TAGS AND HIERARCHIES
-------------------------------------------------------------------------------

Evernote tags are hierarchical.

Import steps:
1) Insert root tags (no parent).
2) Insert child tags (parent id resolved from map).
3) Insert note_tag relations.

Notes:
- `tags` table enforces unique names per parent.
- Tag ids are stored as `external_id` for future reference.

-------------------------------------------------------------------------------
12. ATTACHMENTS AND IMAGES
-------------------------------------------------------------------------------

Attachments are stored in two places:

1) **Binary files** in `data/files/<prefix>/<hash>.<ext>`.
2) **Metadata** in the `attachments` table.

Images inside note HTML are handled separately via:
- `note_files` and `ocr_files` tables (generated later by app).
- Stored content uses `notes-file://files/...` references.

Important:
- The `attachments` table does **not** automatically create HTML references.
- The note HTML references are derived from ENML `<en-media>` tags.

-------------------------------------------------------------------------------
13. OCR INTEGRATION AFTER IMPORT
-------------------------------------------------------------------------------

Once notes are imported, the app performs OCR indexing:

1) `backfill_note_files_and_ocr()` scans note HTML for images.
2) It creates `note_files` entries and `ocr_files` entries.
3) OCR queue reads `ocr_files` and writes `ocr_text`.
4) `ocr_fts` index is updated for search.

The import stage itself does NOT run OCR. OCR is automatic at runtime.

-------------------------------------------------------------------------------
14. EXPECTED RUNTIME EFFECTS IN THE APP
-------------------------------------------------------------------------------

After a successful import:

- Notes list and notebooks should appear immediately.
- Images should render (via asset protocol conversion).
- OCR indexing will start in background.
- Search should work against:
  - `notes_fts` (text)
  - `ocr_fts` (OCR text)

If images are missing:
- Check `data/files` contains the image by hash.
- Check note HTML has `notes-file://files/...` URLs.
- Check asset protocol allow list in Tauri config.

-------------------------------------------------------------------------------
15. TROUBLESHOOTING AND VALIDATION
-------------------------------------------------------------------------------

15.1 RTE decoding failures

Symptoms:
- Export logs decode errors.
- Note content is empty.

Actions:
- Inspect `decodeErrors` in export JSON.
- Confirm `internal_rteDoc` path.
- Check the note id path pattern in `internal_rteDoc`.

15.2 Missing assets

Symptoms:
- Images show as broken.
- `data/files` folder missing images.

Actions:
- Ensure `--resources` and `--assets` were passed to export.
- Check `resource-cache/<user>/<noteId>/<dataHash>` exists.
- Confirm `attachments` entries have `dataHash`.
- Confirm `export_assets` contains copied files.
- Confirm import copies assets to `data/files`.

15.3 ENML rendering issues

Symptoms:
- Placeholder `<p><br></p>` entries.
- Missing content.

Actions:
- Ensure `normalizeEnmlToHtml` is applied.
- Check `docs/IMPORT_IMAGES.md` for normalization details.

-------------------------------------------------------------------------------
16. COMMON PITFALLS AND EDGE CASES
-------------------------------------------------------------------------------

- **Stackless notebooks**:
  They are grouped under an "Unsorted" stack.

- **Missing RTE file**:
  The note will be created with empty or partial content.

- **Invalid ENML**:
  Converted into plain HTML; some formatting may be lost.

- **Attachments without dataHash**:
  No asset file can be matched, image references may remain unresolved.

- **Mixed resource roots**:
  `resource-cache` may contain multiple `user*` directories.
  The export script scans all user subfolders.

- **Notebooks / tags naming**:
  The script falls back to `id` if label is missing.

-------------------------------------------------------------------------------
17. SUGGESTED VERIFICATION CHECKLIST
-------------------------------------------------------------------------------

After export:
- JSON file exists and is not empty.
- `meta.noteCount` matches expected note count.
- `missingRteCount` is small or zero.
- Assets folder has files.

After import:
- `data/notes.db` created.
- `data/files/` contains asset subfolders.
- App lists notebooks and notes.
- Images render in note editor.
- OCR status increases over time.

-------------------------------------------------------------------------------
END
-------------------------------------------------------------------------------
