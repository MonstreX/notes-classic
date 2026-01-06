# Import Pipelines

This document describes the **in-app** import flows for Notes Classic exports, Obsidian (Markdown), HTML, and Text datasets, plus the common pitfalls and guardrails used to keep imports stable.

Evernote import is documented separately: `docs/EVERNOTE-IMPORT.md`.

## Common Flow (All Importers)

1) **Select folder** in the import modal.
2) **Scan** the folder and show a summary (notes, stacks, notebooks, images, attachments).
3) **Confirm replace** if the current storage has data.
4) **Backup** the current storage to `data/backups/<type>-YYYYMMDD-HHMMSS/`.
5) **Clear storage** (`notes.db`, `files/`, OCR tables).
6) **Import** notes + assets into the new database.
7) **Restart required** dialog is shown at the end.

### Guardrails / Pitfalls
- **OCR must be paused during import.** If OCR runs while clearing/rebuilding the DB, SQLite locks and foreign-key errors happen.
- **Attachments are tokenized then replaced.** Raw `__ATTACHMENT_*__` tokens must be replaced with `note-attachment` HTML.
- **Assets are never shared between notes.** Each imported file is stored as a distinct entry (unique hash + file on disk).
- **H1 titles are removed.** Note titles are already displayed above the editor; H1 in body causes duplication.
- **Relative asset paths must be resolved.** Importers resolve `attachments/...` and `images/...` against the note's directory and fallback to root.

## Notes Classic Export Import

**Input:**
- Folder created by Notes Classic export (contains `manifest.json`, `notes/`, `attachments/`, `files/`).

**Behavior:**
- Imports all entities listed in `manifest.json` with original IDs preserved.
- Copies `attachments/` into storage `files/` and restores `local_path` as `files/<rel>`.
- Copies `files/` into storage `files/` and restores OCR data from `ocr_files` + `ocr_text`.
- Notes are read from `notes/<id>.html`, meta from `notes/<id>.meta.json`.
- `notes_text`, `note_tags`, and `note_history` are imported as-is.

**Notes:**
- Import requires a full replace (current storage is cleared).
- A backup is created under `data/backups/notes-classic-YYYYMMDD-HHMMSS`.

## Obsidian (Markdown) Import

**Input:**
- Folder with `.md` files and an `attachments/` folder with images + files.

**Notes:**
- Stack/Notebook mapping uses folder structure:
  - `Root/Note.md`  `Root / General`
  - `Root/Project/Note.md`  `Root / Project`
  - `Root/Project/API/Note.md`  `Root / Project.API`
- Markdown conversions:
  - ``` fenced code ```  `div.note-code` (AUTO language)
  - `- [ ]` / `- [x]`  `ul[data-en-todo]` with `li[data-en-checked]`
  - `<pre>` blocks  `div.note-callout`
  - `![[...]]`  image or attachment
  - `[[...]]`  note link if a target note exists, otherwise plain text
  - Inline `attachments/...` are resolved to real files
- `external_id` for notes is `obsidian:<rel/path>`.

## HTML Import

**Input:**
- Folder with `.html` files and `attachments/` folder.

**Transformations:**
- `<h1>` removed.
- `<pre><code>`  `div.note-code` (AUTO language).
- `<ul>/<ol>` with `input[type=checkbox]`  `ul[data-en-todo]` with `li[data-en-checked]`.
- `<img src="attachments/...">`  stored in `files/` and rewritten to `files/<hash>.<ext>`.
- `<a href="attachments/...">`  stored as `note-attachment` block.
- `external_id` for notes is `html:<rel/path>`.

## Text Import

**Input:**
- Folder with `.txt` files and `attachments/` folder.

**Assumptions:**
- Text content is **Markdown-like** (same syntax as Obsidian demo).

**Transformations:**
- Same Markdown conversions as Obsidian import.
- `[[attachments/...]]` and `![[attachments/...]]` are resolved to attachments/images.
- `external_id` for notes is `text:<rel/path>`.

## Demo Datasets

Demo sources live outside the repo:
`E:\dev\notes-import-examples\obsidian`, `.../html`, `.../text`

They share the same structure and attachments; HTML/Text are regenerated from the Obsidian set.

