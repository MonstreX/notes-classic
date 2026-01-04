## 15) Performance considerations

Notes list:

- Backend returns substr(content, 1, 4000) for list view.
- Excerpts are derived by stripping HTML in controller.
- Sorting is done in memory for the current list.

Editor:

- Updates are scheduled to avoid continuous sync writes.
- Editor content updates are avoided if unchanged.

Search:

- FTS queries are used for text and OCR.
- Highlighting is disabled for extremely large HTML.

OCR:

- Batch size is small to keep UI responsive.
- Worker is restarted on failures.

----------------------------------------------------------------
