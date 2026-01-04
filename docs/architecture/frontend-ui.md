## 5) Frontend runtime and UI modules

### 5.1 Entry point (src/main.ts)

Startup steps:

1) Load Jodit CSS and highlight.js CSS.
2) Load global SCSS bundle.
3) Inject SVG sprite from assets/icons.svg.
4) Mount the app into #root using appShell.mountApp.

No other global side effects exist in main.ts.

### 5.2 App shell (src/ui/appShell.ts)

appShell is the UI coordinator.

Responsibilities:

- Build the full DOM layout (sidebar, list, editor).
- Mount child modules and provide handlers.
- Manage resize handles.
- Manage editor loading overlay.
- Manage empty state when no note is selected.
- Render on store updates.

DOM structure (simplified):

- root
  - .app-loading
  - .app-shell
    - .app-shell__sidebar
      - .app-shell__sidebar-inner
        - Search button
        - New Note button
        - .app-shell__sidebar-host (sidebar module)
      - .app-shell__resize-handle
    - .app-shell__list
      - .app-shell__list-host (notes list module)
      - .app-shell__resize-handle--list
    - .app-shell__editor
      - .app-shell__editor-shell
        - metaBar (mountMetaBar)
        - .app-shell__titlebar with title input
        - editor host (mountEditor)
        - tagsBar (mountTagsBar)
      - empty state (Select a note)

State-driven render logic:

- If isLoaded is false, show loading screen.
- Sidebar width and list width are applied from state.
- Title input mirrors state.title.
- Editor shell is hidden if no selected note.
- Empty state is shown if no selected note.
- Editor loading overlay is shown while loading or updating.

Editor update scheduling:

- scheduleEditorUpdate stores pending noteId and content.
- Uses a 0 ms timeout to batch updates.
- Cancels stale updates when selection changes.
- Avoids re-render when note and content match last state.

Resizing:

- Mousedown on resize handle sets flags.
- Mousemove adjusts sidebarWidth or listWidth via actions.
- Mouseup clears flags.

### 5.3 Sidebar module (src/ui/sidebar.ts)

Responsibilities:

- Render notebooks (stack + notebook) and tags tree.
- Handle selection, expand/collapse, and DnD.
- Provide action buttons (add notebook, add tag, add note).
- Keep scroll position stable on re-render.
- Maintain drag overlay and indicators.

Notebooks rendering:

- Top level is stack (parentId is null).
- Stack nodes can expand to show notebooks.
- Notebooks cannot contain children.
- All Notes entry is rendered above notebook tree.

Tags rendering:

- Unlimited depth.
- Tags sorted alphabetically by name at each level.
- Each tag row has Add and Expand actions.
- Tags section can be collapsed entirely.

Selection behavior:

- Clicking a stack toggles expansion and selects it.
- Clicking a notebook selects it.
- Clicking a tag selects it and optionally toggles if it has children.
- Clicking All Notes clears notebook and tag selection.

Expansion behavior:

- Expansion states are stored in state.expandedNotebooks and state.expandedTags.
- Animations are done using max-height and opacity.
- Tags section uses a similar animation for whole tree.

Drag and drop:

- Pointer down starts drag tracking.
- Requires a hold delay (180 ms) and movement threshold.
- Drag overlay shows only the item name.
- Notebook drag uses a green drop line.
- Tag drag uses highlight on target and on tags root.
- Drop targets are detected with elementFromPoint.

DnD constraints:

- Stacks can only be reordered at root.
- Notebooks can only be moved inside stacks.
- Tags can be reparented under any tag or root.

Scroll handling:

- Re-render keeps scrollTop.
- Tags section auto-scrolls after expanding to keep it visible.

### 5.4 Notes list module (src/ui/notesList.ts)

Responsibilities:

- Render header (title, count, actions).
- Render notes list in compact or detailed mode.
- Provide sort menu and view toggle.
- Support note DnD to notebooks.
- Support delete via Delete key.

Header:

- Title shows current notebook or tag, or Notes for All Notes.
- Count shows number of notes in list.
- Actions include filter, sort, and view buttons.

List view:

- Compact: single line with title and date.
- Detailed: title, excerpt, and date.
- Excerpt derived from content in controller.

Sort menu:

- Built dynamically when sort button is clicked.
- Items: Newest first, Oldest first, Name A-Z, Name Z-A.
- Clicking an item updates state via handlers.onSelectSort.
- Menu closes on outside click or on selection.

DnD notes:

- Pointer down on a note row starts drag tracking.
- Drag overlay shows note title only, or "N Notes" for group drag.
- Drop target is resolved in sidebar via elementFromPoint.
- Drop onto All Notes or a notebook updates note notebookId.
- Drop onto a tag adds that tag to the dragged notes.
- Drop onto Trash deletes (or trashes) the dragged notes.
- Drag uses custom overlay and highlight class on target.

Selection:

- Single click selects one note.
- Shift-click selects a range.
- Ctrl/Cmd-click toggles individual notes.
- Selected notes are tracked as selectedNoteIds in state.

### 5.5 Editor module (src/ui/editor.ts)

Editor module wraps Jodit and adds custom behavior.

Core configuration:

- readonly false by default.
- toolbarAdaptive false.
- statusbar false.
- minimal buttons set.
- allowResizeTags set for img and table.
- resizer enabled with size preview.
- extraPlugins: resizer, resize-cells.

Toolbar:

- bold, italic, underline
- ul, ol
- callout, todo, codeblock, encrypt
- link, image
- undo, redo

Custom controls:

- callout: wraps selected fragment into div.note-callout.
- todo: converts list to ul[data-en-todo=true], toggles li flags.
- codeblock: wraps selection into div.note-code with toolbar.
- encrypt: replaces selection with a password-protected secure block.
- attach: inserts a file attachment handle at the cursor.

Code block behavior:

- Toolbar contains language select and Copy button.
- highlight.js runs on each code block.
- Supports php, html, js, css, and auto.

Callout behavior:

- Enter inserts a paragraph inside the callout.
- Backspace at start removes callout.
- Delete at end removes callout.
- Arrow navigation exits at boundaries.
- Empty callout removes itself.

HR insertion:

- Typing --- at end of a line and pressing Enter inserts hr.
- Works outside callout/code blocks.

Links:

- Click on anchor opens in system browser via shell plugin.
- Prevents default navigation in editor.

Preview editor:

- Jodit with readonly true and empty toolbars.
- Used in search modal preview.

### 5.6 Meta bar (src/ui/metaBar.ts)

Displays context above editor:

- Stack icon and name.
- Notebook icon and name.
- Last edited timestamp from active note.

When no note is selected:

- Meta elements are hidden.
- Text is cleared.

### 5.7 Tags bar (src/ui/tagsBar.ts)

Responsibilities:

- Render tag chips for the active note.
- Provide input for adding tags.
- Provide suggestion dropdown.

Tag suggestions:

- Trigger after 2 characters.
- Case-insensitive, prefix match only.
- Excludes tags already assigned to the note.
- Enter selects active suggestion if present.
- Tab always adds typed value as new tag.

### 5.8 Search modal (src/ui/searchModal.ts)

Responsibilities:

- Render modal for text and OCR search.
- Handle search scope (current notebook vs everywhere).
- Show OCR indexing status.
- Render results and preview.

Search flow:

- User clicks Search button or presses Enter.
- tokenizeQuery splits input into tokens.
- buildSearchQuery builds FTS query with wildcards.
- searchNotes invoked via service.
- Results are capped to 100.
- First result is auto-selected for preview.

Result layout:

- Title on first line.
- Stack and notebook on second line.
- OCR match shows image icon.
- Open button opens note and closes modal.

Preview:

- Uses readonly Jodit.
- Content passes through toDisplayContent.
- Matches highlighted if content size is below threshold.

### 5.9 Context menus (src/ui/contextMenu.ts)

Responsibilities:

- Create right-click menus.
- Manage nested submenu for Move To.
- Close menus on outside click, scroll, resize, or Escape.

Menu types:

- Note menu: Delete, Move To submenu.
- Notebook menu: Delete.
- Tag menu: Delete.
- Notes group menu: "N Notes selected", Delete Notes, Move To submenu.
- Trash group menu: "N Notes selected", Restore Notes, Delete Permanently.

### 5.10 Dialogs (src/ui/dialogs.ts)

Responsibilities:

- Create modal overlays for create notebook/tag and confirmations.
- Provide password prompt for encrypted blocks.
- Validate input.
- Handle Enter and Escape.
- Remove DOM on completion.

Dialog types:

- Create stack or notebook.
- Create tag (root or nested).
- Confirmation for delete.

----------------------------------------------------------------
