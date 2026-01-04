## 6) Controller and store flows

### 6.1 Controller (src/controllers/appController.ts)

Key helpers:

- sortNotes: sorts by title or updatedAt, stable by id.
- stripTags and buildExcerpt: removes HTML for list previews.
- normalizeTagName: trims input.
- findTagByName: case-insensitive lookup.

fetchData:

- Loads notebooks, notes, and counts in parallel.
- Picks notes source based on selected tag or notebook.
- Builds excerpts for notes list.
- Applies sorting based on state.
- Ensures selected note exists in new list.
- Sets isNoteLoading when selection changes.
- Triggers loadSelectedNote if needed.

loadSelectedNote:

- Uses noteLoadToken to prevent stale updates.
- Fetches full note content.
- Normalizes ENML and file URLs (notes-file -> files).
- Converts to display content using asset protocol.
- Loads tags for selected note.
- Updates activeNote, title, content, and noteTags.
- Clears isNoteLoading when done.

Autosave:

- Debounced by 1 second.
- Writes only if title or content changed.
- Converts content back to storage form.
- Updates notes list in store with updatedAt and excerpt.

Actions map:

- setTitle, setContent
- selectNote, setNoteSelection, selectNotebook, selectTag
- toggleNotebook, toggleTag, toggleTagsSection
- setSidebarWidth, setListWidth
- setNotesListView, setNotesSort
- addTagToNote, removeTagFromNote
- addTagToNotes
- createTag, deleteTag, moveTag
- createNote, createNoteInNotebook, deleteNote, deleteNotes
- createNotebook, deleteNotebook
- moveNoteToNotebook, moveNotesToNotebook, moveNotebookByDrag
- restoreNote, restoreNotes, restoreAllTrash
- openNote (recorded navigation)
- goBack, goForward (note history navigation)

Selection safeguards:

- deleteNote tries to select a valid note after deletion.
- If no notes remain, clears active note and editor state.
- When moving a note away from current notebook, selection is adjusted.

Settings sync:

- appStore.subscribe persists settings on relevant changes.
- Selection changes trigger fetchData.
- Notes list view changes notify backend to update menu checks.

### 6.2 Store (src/state/store.ts)

State structure:

- notebooks: Notebook[]
- notes: NoteListItem[]
- noteCounts: Map<notebookId, count>
- totalNotes: number
- notesListView: detailed or compact
- notesSortBy: updated or title
- notesSortDir: asc or desc
- tags: Tag[]
- noteTags: Tag[] for selected note
- selectedNotebookId: number or null
- selectedTagId: number or null
- selectedNoteId: number or null
- selectedNoteIds: Set<number>
- selectedTrash: boolean
- expandedNotebooks: Set<number>
- expandedTags: Set<number>
- tagsSectionExpanded: boolean
- sidebarWidth: number
- listWidth: number
- trashedCount: number
- deleteToTrash: boolean
- title: string
- content: string
- activeNote: NoteDetail or null
- isLoaded: boolean
- isNoteLoading: boolean
- historyBack: number[]
- historyForward: number[]
- historyCurrent: number | null

History navigation:

- The app records explicit note opens (list clicks, search opens, note links).
- A back stack and forward stack behave like a browser history.
- Back/Forward actions update selection and reload note content.
- Automatic selection changes (e.g., after delete) do not create history entries.

Update semantics:

- setState merges partial object.
- update uses a cloned draft and then replaces state.
- notify triggers all subscribed listeners.

----------------------------------------------------------------
