# Assets and images

Notes store images inside HTML using relative `files/...` paths.
At render time we convert these paths to the Tauri asset protocol via
`convertFileSrc`, so the editor loads images directly from disk.

Asset protocol access is restricted to relative `data/` paths so it works for
both dev and packaged builds:

- `data/**` when the executable sits next to the `data` folder (portable build)
- `../data/**`, `../../data/**`, `../../../data/**` for dev (`cwd` is `src-tauri`)

If the app is launched from a different working directory or the `data` folder
is moved, images will not resolve. The app expects a portable layout with
`data/` adjacent to the executable (or to the project root in dev).

Storage rules:

- Each inserted image becomes its own file on disk, even if the bytes match
  another image in a different note.
- File names are generated per insert; the original filename is not used as a
  stable reference in HTML.
- Removing an image from a note removes the corresponding file if it is no
  longer referenced by any note.

Legacy:

- Older notes may still contain `notes-file://files/...`; these are normalized
  to `files/...` on load and via migration.

Note files vs attachments:

- Inline images are tracked via note_files/ocr_files for OCR and search.
- Attachments are separate entities with metadata and actions and live under
  data/files/attachments.
