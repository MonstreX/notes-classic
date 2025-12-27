# Assets and images

Notes store images using the `notes-file://files/...` scheme inside HTML content.
At render time we convert these paths to the Tauri `asset://` protocol via
`convertFileSrc`, so the editor loads images directly from disk without base64.

Asset protocol access is restricted to relative `data/` paths so it works for
both dev and packaged builds:

- `data/**` when the executable sits next to the `data` folder (portable build)
- `../data/**`, `../../data/**`, `../../../data/**` for dev (`cwd` is `src-tauri`)

If the app is launched from a different working directory or the `data` folder
is moved, images will not resolve. The app expects a portable layout with
`data/` adjacent to the executable (or to the project root in dev).
