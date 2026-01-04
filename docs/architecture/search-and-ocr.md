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
