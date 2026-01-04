## 11) Backend commands and menu wiring

### 11.1 Command list

Each frontend service maps to one of these commands:

- get_notebooks
- create_notebook
- delete_notebook
- move_notebook
- move_note
- get_notes
- get_notes_by_tag
- search_notes
- get_note
- get_note_counts
- get_data_dir
- upsert_note
- delete_note
- get_ocr_pending_files
- upsert_ocr_text
- mark_ocr_failed
- get_ocr_stats
- get_tags
- get_note_tags
- create_tag
- add_note_tag
- remove_note_tag
- delete_tag
- update_tag_parent
- set_notes_list_view
- get_settings
- set_settings

### 11.2 Menu events

Menu items emit events for:

- Notes list view switch (detailed/compact).
- Import Evernote placeholder.

UI listens with tauri event API and updates store.

Menu localization:

- Menu labels are loaded from resources/i18n/*.json on startup.
- Language is read from settings/app.json.
- When language changes, the app restarts so native menu labels are rebuilt.

----------------------------------------------------------------
