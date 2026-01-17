# Architecture Index
This is the entry point for the full architecture documentation.
Each subsystem is documented in its own file under docs/architecture/.
## Quick summary
- Local-first, portable desktop app (Tauri v2 + Rust + vanilla TS).
- SQLite for structured data, file store for assets and attachments.
- Jodit editor with custom blocks (callouts, code, secure blocks, TODOs).
- OCR via tesseract.js, indexed for search.
- i18n (EN/RU) with menu localization and restart on language changes.
## Document map
1. [Goals and constraints](goals-and-constraints.md)
2. [System map](system-map.md)
3. [Source tree and responsibilities](source-tree.md)
4. [Layered architecture](layered-architecture.md)
5. [Frontend runtime and UI modules](frontend-ui.md)
6. [Controller and store flows](controllers-and-store.md)
7. [Service layer and content pipeline](services-and-content.md)
8. [Editor architecture and custom blocks](editor.md)
9. [Search and OCR architecture](search-and-ocr.md)
10. [Database schema and migrations](database.md)
11. [Backend commands and menu wiring](backend-and-menu.md)
12. [Storage and asset protocol](storage-and-assets.md)
13. [Settings persistence](settings.md)
14. [Error handling and logging](error-handling.md)
15. [Performance considerations](performance.md)
16. [Extension points and known risks](extension-points.md)
17. [File-by-file notes (exhaustive)](file-by-file.md)
18. [Timing constants and retries](timing-and-retries.md)
19. [Localization (i18n)](localization.md)
20. [Import pipelines (Evernote / Markdown (.md) / HTML / Text)](../IMPORTS.md)
