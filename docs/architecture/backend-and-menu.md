## 11) Backend commands and menu wiring

### 11.1 Command list

Frontend services map to backend commands exposed in `src-tauri/src/main.rs`.
Commands are grouped by domain (notes, notebooks, tags, attachments, storage, OCR,
settings, app lifecycle). The list below highlights the primary ones used by the
UI; the full list is in the Rust source.

- Notes: get_notes, get_note, upsert_note, delete_note, search_notes
- Notebooks: get_notebooks, create_notebook, delete_notebook, move_notebook, move_note
- Tags: get_tags, create_tag, add_note_tag, remove_note_tag, delete_tag, update_tag_parent
- Attachments: import_attachment, read_attachment_text, save_attachment_as, delete_attachment
- Storage: get_data_dir, get_storage_info, set_storage_path, set_storage_default
- OCR: get_ocr_pending_files, upsert_ocr_text, mark_ocr_failed, get_ocr_stats
- Settings: get_settings, set_settings
- App lifecycle: restart_app, exit_app

### 11.2 Menu events

Menu items emit events for:

- Notes list view switch (detailed/compact).
- New note / new notebook / new stack.
- Delete note.
- Search / Settings.
- Import Evernote.

UI listens with tauri event API and updates store.

Menu localization:

- Menu labels are loaded from resources/i18n/*.json on startup.
- Language is read from settings/app.json.
- When language changes, the app restarts so native menu labels are rebuilt.

----------------------------------------------------------------
