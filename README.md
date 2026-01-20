# Notes Classic

Notes Classic is a local-first note manager inspired by the 2015 Evernote era.
It runs as a Tauri desktop app with a rich editor, tagging, OCR search, and
import/export pipelines. All data is stored locally by default and can be moved
to any folder via Settings.

This README is intentionally detailed so the project can be built and shipped
without internal docs.

## Core Capabilities

- **Two-level organization**: Stacks + Notebooks
- **Tags**: Nested tags with drag/drop sorting
- **Rich editor (Jodit)**:
  - Callouts, code blocks, todo lists
  - Attachments (download / view / delete)
  - Image insertion and resizing
- **Encrypted blocks** (view-only decrypt)
- **OCR indexing** for images (searchable text)
- **Note links** and **back/forward history**
- **Trash** with restore and bulk clean
- **Importers**:
  - Evernote local database
  - Notes Classic export package
  - Markdown (.md)
  - HTML
  - Text (.txt)
- **Exporters**:
  - Notes Classic export package
  - Markdown (.md)
  - HTML
  - Text (.txt)
  - PDF (native, wkhtmltopdf)

## Data Model Overview

Notes Classic uses a SQLite database (`notes.db`) plus a `files/` directory for
binary assets:

- `notes` and `notebooks` store metadata and hierarchy
- `note_text` stores HTML content
- `note_files` lists image and attachment files referenced in notes
- `ocr_files` and `ocr_text` store OCR indexing state

Assets are **not shared between notes** even if bytes are identical. This keeps
imports deterministic and avoids ambiguous ownership during deletion.

## Storage Layout

By default, runtime data lives in:

- `data/` (database + files + OCR state)
- `settings/` (user settings)

Both folders are created at runtime and are intentionally ignored by git. The
storage path can be changed in Settings. The app copies or switches storage
according to the selected path.

## Build Requirements

- Node.js 18+ and npm
- Rust (stable) + Cargo
- Tauri prerequisites by OS (WebView + native deps)

## Environment Setup

### Windows

1) Install Node.js 18+ and Rust (stable).
2) Install WebView2 Runtime (required by Tauri).
3) Install MSVC build tools if not already present.

### Linux (Debian/Ubuntu/Mint)

Install core build deps and WebKit/GTK:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### macOS

1) Install Xcode Command Line Tools:

```bash
xcode-select --install
```

2) Install Node.js 18+ and Rust (stable).

## Development (All Platforms)

```bash
npm install
npm run tauri dev
```

## Release Build (All Platforms)

```bash
npm run tauri build
```

Artifacts are written to `src-tauri/target/release` (platform-specific).

## Platform-Specific Build Notes

### Windows

- Output: `.exe` and installer artifacts in `src-tauri/target/release`.
- PDF export relies on bundled resources:
  - `resources/pdf/win/wkhtmltopdf.exe`
  - `resources/pdf/win/wkhtmltox.dll`

### Linux

- Output: native bundle in `src-tauri/target/release`.
- PDF export relies on bundled resources:
  - `resources/pdf/linux/wkhtmltopdf`
  - `resources/pdf/linux/libwkhtmltox.so.0.12.6`

### macOS

- Output: `.app` bundle in `src-tauri/target/release`.
- PDF export uses `resources/pdf/mac/wkhtmltopdf.pkg`.

## OCR Resources

OCR is powered by tesseract.js and bundled resources:

- `resources/ocr/worker.min.js`
- `resources/ocr/tesseract-core.wasm(.js)`
- `resources/ocr/tessdata/eng.traineddata.gz`
- `resources/ocr/tessdata/rus.traineddata.gz`

These must remain in place for OCR to work in packaged builds.

## Import / Export

Notes Classic supports multiple import/export formats. All exports are designed
to round-trip without losing structure or assets.

### Notes Classic Export

Produces a folder containing:

- `manifest.json`
- `notes/` (HTML + per-note metadata)
- `files/` and `attachments/`

### Markdown / HTML / Text Exports

Produces a folder with:

- Note files in the chosen format
- `attachments/` folder for images and files

### Evernote Import

Requires selecting the local Evernote data directory. The importer scans the
DB and resource cache, then rebuilds Notes Classic storage.

## Encrypted Blocks

Encrypted blocks store their data inside a protected container. Decrypting is
read-only. Removal of encryption restores the original content and asset links.

## Note Links

Internal links use `note://<uuid>` and open the target note directly.

## Releasing / Publishing Checklist

- Confirm `npm run tauri build` passes on target OS
- Ensure `resources/ocr` and `resources/pdf` are bundled
- Verify import/export round-trips on example datasets
- Remove all local data (`data/`, `settings/`)
- Update version in `package.json` and `tauri.conf.json`
- Add `LICENSE` and `THIRD_PARTY_NOTICES.md`
