## 13) Settings persistence

Stored fields:

- sidebarWidth
- listWidth
- selectedNotebookId
- selectedTagId
- selectedNoteId
- expandedNotebooks
- expandedTags
- tagsSectionExpanded
- notesListView
- notesSortBy
- notesSortDir
- deleteToTrash
- language (ui language, en/ru)
- dataDir (optional override for storage location)

File format:

- JSON, pretty-printed, stored in settings/app.json.
- Language changes are applied after restart so the native menu can reload.

Legacy migration:

- Old localStorage key is migrated on first run.

----------------------------------------------------------------
