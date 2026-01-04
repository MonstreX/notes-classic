# Localization (i18n)
This document describes the localization system for Notes Classic (EN/RU).
## Overview
- UI strings are stored in JSON resource files under src-tauri/resources/i18n/.
- The frontend loads these JSON files at runtime and exposes 	() and 	Count() helpers.
- The native (Tauri) menu labels are also localized using the same JSON files.
- Language changes require an app restart so native menus are rebuilt.
## Files and responsibilities
- src-tauri/resources/i18n/en.json
- src-tauri/resources/i18n/ru.json
  - Flat key/value dictionaries for UI strings.
  - Keys are dot-delimited (e.g. menu.file, search.title).
- src/services/i18n.ts
  - Loads translations via convertFileSrc() and etch().
  - Provides 	(key, vars?) and 	Count(baseKey, count, vars?).
  - Uses Intl.PluralRules for plural categories.
  - Falls back to EN if a language file is missing or empty.
- src/main.ts
  - Picks the initial language.
  - If language is not yet stored, it uses the OS language and writes it to settings.
  - After first-run language selection, it restarts the app to refresh the native menu.
- src/ui/settingsModal.ts
  - Renders the Language selector.
  - On Apply, updates settings and triggers a restart dialog.
- src-tauri/src/main.rs
  - Builds the native menu from i18n resources.
  - Reads settings/app.json to select language.
  - Uses AppHandle::path().resource_dir() to locate resources in production.
## Language selection flow
1) On first run, get_settings returns no language.
2) The frontend uses the OS language if supported, otherwise EN.
3) The chosen language is stored in settings/app.json.
4) The app restarts to ensure the native menu uses the new language.
For subsequent runs, the stored language is used directly and no restart is needed.
## Pluralization
- Use 	Count(baseKey, count).
- Translation keys must exist for plural categories, e.g.:
`
menu.notes_selected.one
menu.notes_selected.few
menu.notes_selected.many
menu.notes_selected.other
`
## Adding a new language
1) Add src-tauri/resources/i18n/<lang>.json.
2) Add the language code to SUPPORTED_LANGS in src/services/i18n.ts.
3) Add language.<code> label for the selector.
4) Rebuild the app so resources are bundled.
## Failure behavior
- If a language file cannot be loaded, the app falls back to EN.
- Missing keys resolve to the EN string, then to the key itself.
## Notes
- Localization is intentionally flat (no nested objects).
- Menu strings are built once at startup; they do not change until restart.