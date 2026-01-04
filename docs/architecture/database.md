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
