# Notes Classic Export Format

This document describes the export package produced by the in-app export
feature (File -> Export -> Notes Classic...).

The goal is to provide a complete, self-contained snapshot of the storage
that other tools can parse and import.

---

## Export Root Layout

When exporting, the app creates a timestamped folder inside the user-selected
destination:

```
notes-classic-export-YYYYMMDD-HHMMSS/
  manifest.json
  notes/
    42.html
    42.meta.json
    58.html
    58.meta.json
  attachments/
    8f/8f7c99176072ebad2e4846e37ea3d099.attachment
    42/4272ebab594d1f29464b1dea909d7491.pdf
  files/
    65/65260e5d9cc809338116f1d58a13f03d.png
    7a/7a44c7e1ad57a8a8b3cc4a8e6d9c0c7f.jpg
```

Notes:
- `notes/` contains one HTML file per note.
- `notes/*.meta.json` mirrors the note row metadata.
- `attachments/` contains all attachments stored in the database.
- `files/` contains OCR-indexed image files.
- `manifest.json` contains the relational data needed to rebuild the database.

---

## Notes Content

Each note is exported as:

- `notes/<id>.html` - the raw HTML content stored in the database.
- `notes/<id>.meta.json` - metadata for that note (same fields as `notes`
  array in `manifest.json`).

The HTML is stored as-is. It is **not** rewritten during export. If your
importer needs to replace local asset URLs, it should rewrite them based
on `attachments/` and `files/` entries in the manifest.

---

## Manifest Structure

`manifest.json` provides everything needed to rebuild SQLite tables and
relink files. The structure is:

```json
{
  "version": "1.0",
  "exported_at": "2026-01-06T11:22:33Z",
  "notebooks": [...],
  "notes": [...],
  "notes_text": [...],
  "tags": [...],
  "note_tags": [...],
  "attachments": [...],
  "ocr_files": [...],
  "note_files": [...],
  "ocr_text": [...],
  "note_history": [...]
}
```

### notebooks
Each notebook (stack or notebook).

Fields:
- `id` (int)
- `name` (string)
- `created_at` (int, unix seconds)
- `parent_id` (int | null)
- `notebook_type` (string, `stack` or `notebook`)
- `sort_order` (int)
- `external_id` (string | null)

### notes
Each note row (metadata only).

Fields:
- `id`, `title`, `created_at`, `updated_at`
- `sync_status`, `remote_id`, `external_id`
- `notebook_id`, `meta`, `content_hash`, `content_size`
- `deleted_at`, `deleted_from_notebook_id`
- `content_path` (string, relative path to HTML)
- `meta_path` (string, relative path to meta JSON)

### notes_text
Plain-text index rows.

Fields:
- `note_id`
- `title`
- `plain_text`

### tags
Tag tree (unlimited nesting).

Fields:
- `id`, `name`, `parent_id`
- `created_at`, `updated_at`
- `external_id`

### note_tags
Note-to-tag mapping.

Fields:
- `note_id`
- `tag_id`

### attachments
Files stored as attachments in notes.

Fields:
- `id`, `note_id`
- `filename`, `mime`, `size`, `width`, `height`
- `hash`, `external_id`, `local_path`, `source_url`
- `is_attachment`, `created_at`, `updated_at`
- `export_path` (relative path inside the export folder)

### ocr_files
Files that were OCR-indexed (usually images).

Fields:
- `id`
- `file_path` (relative to storage `files/`)
- `attempts_left`
- `last_error`
- `export_path` (relative path inside the export folder)

### note_files
Note-to-ocr_file mapping.

Fields:
- `note_id`
- `file_id`

### ocr_text
OCR results.

Fields:
- `file_id`
- `lang`
- `text`
- `hash`
- `updated_at`

### note_history
Visited note history entries.

Fields:
- `id`
- `note_id`
- `opened_at`
- `note_title`
- `notebook_id`, `notebook_name`
- `stack_id`, `stack_name`

---

## Error Handling

The export operation collects non-fatal errors (e.g., missing files that
cannot be copied). The UI shows a summary and prints the manifest path
so the export can still be used if partial issues exist.

---

## Import Strategy (High-Level)

To import this format:
1) Parse `manifest.json`.
2) Create notebooks, notes, tags, and note-tags.
3) Copy `notes/*.html` into your content store.
4) Copy `attachments/` and `files/` into your own storage.
5) Rebuild OCR indices from `ocr_text` as needed.
6) Map `note_files` for OCR/image search.

This format intentionally mirrors Notes Classic's SQLite schema to keep
the export lossless and deterministic.
