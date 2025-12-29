import type { AppState } from "../state/store";
import type { SidebarState } from "./sidebar";
import type { NotesListState } from "./notesList";
import type { EditorScheduler } from "./editorScheduler";
import type { AppLayout } from "./appLayout";

type RendererDeps = {
  layout: AppLayout;
  sidebar: { update: (state: SidebarState) => void };
  notesList: { update: (state: NotesListState) => void };
  metaBar: { update: (state: { hasNote: boolean; notebooks: AppState["notebooks"]; selectedNotebookId: number | null; activeNote: AppState["activeNote"] | null }) => void };
  tagsBar: { update: (state: { hasNote: boolean; tags: AppState["tags"]; noteTags: AppState["noteTags"] }) => void };
  editorScheduler: EditorScheduler;
  isEditorFocused: () => boolean;
};

export const createAppRenderer = (deps: RendererDeps) => {
  let lastSidebarState: SidebarState | null = null;
  let lastNotesListState: NotesListState | null = null;

  const render = (state: AppState) => {
    if (!state.isLoaded) {
      deps.layout.setLoaded(false);
      return;
    }
    deps.layout.setLoaded(true);
    deps.layout.setWidths(state.sidebarWidth, state.listWidth);

    if (deps.layout.titleInput.value !== state.title) {
      deps.layout.titleInput.value = state.title;
    }

    const hasNote = !!state.selectedNoteId;
    deps.layout.setEditorLoadingVisible(hasNote && (state.isNoteLoading || deps.editorScheduler.isUpdating()));
    deps.layout.setNoteVisible(hasNote);

    deps.metaBar.update({
      hasNote,
      notebooks: state.notebooks,
      selectedNotebookId: state.selectedNotebookId,
      activeNote: state.activeNote,
    });

    deps.tagsBar.update({
      hasNote,
      tags: state.tags,
      noteTags: state.noteTags,
    });

    const sidebarState: SidebarState = {
      notebooks: state.notebooks,
      tags: state.tags,
      selectedTagId: state.selectedTagId,
      expandedTags: state.expandedTags,
      tagsSectionExpanded: state.tagsSectionExpanded,
      selectedNotebookId: state.selectedNotebookId,
      selectedTrash: state.selectedTrash,
      expandedNotebooks: state.expandedNotebooks,
      noteCounts: state.noteCounts,
      totalNotes: state.totalNotes,
      trashedCount: state.trashedCount,
    };

    const notesListState: NotesListState = {
      notes: state.notes,
      notebooks: state.notebooks,
      tags: state.tags,
      selectedNotebookId: state.selectedNotebookId,
      selectedTagId: state.selectedTagId,
      selectedNoteId: state.selectedNoteId,
      selectedTrash: state.selectedTrash,
      notesListView: state.notesListView,
      notesSortBy: state.notesSortBy,
      notesSortDir: state.notesSortDir,
    };

    const shouldUpdateSidebar =
      !lastSidebarState ||
      lastSidebarState.notebooks !== sidebarState.notebooks ||
      lastSidebarState.tags !== sidebarState.tags ||
      lastSidebarState.selectedNotebookId !== sidebarState.selectedNotebookId ||
      lastSidebarState.selectedTagId !== sidebarState.selectedTagId ||
      lastSidebarState.selectedTrash !== sidebarState.selectedTrash ||
      lastSidebarState.expandedNotebooks !== sidebarState.expandedNotebooks ||
      lastSidebarState.expandedTags !== sidebarState.expandedTags ||
      lastSidebarState.tagsSectionExpanded !== sidebarState.tagsSectionExpanded ||
      lastSidebarState.noteCounts !== sidebarState.noteCounts ||
      lastSidebarState.totalNotes !== sidebarState.totalNotes ||
      lastSidebarState.trashedCount !== sidebarState.trashedCount;

    if (shouldUpdateSidebar) {
      deps.sidebar.update(sidebarState);
      lastSidebarState = sidebarState;
    }

    const shouldUpdateList =
      !lastNotesListState ||
      lastNotesListState.notes !== notesListState.notes ||
      lastNotesListState.notebooks !== notesListState.notebooks ||
      lastNotesListState.tags !== notesListState.tags ||
      lastNotesListState.selectedNotebookId !== notesListState.selectedNotebookId ||
      lastNotesListState.selectedTagId !== notesListState.selectedTagId ||
      lastNotesListState.selectedTrash !== notesListState.selectedTrash ||
      lastNotesListState.selectedNoteId !== notesListState.selectedNoteId ||
      lastNotesListState.notesListView !== notesListState.notesListView;

    if (shouldUpdateList) {
      deps.notesList.update(notesListState);
      lastNotesListState = notesListState;
    }

    if (hasNote) {
      const readyNote = state.activeNote && state.activeNote.id === state.selectedNoteId;
      if (readyNote && !state.isNoteLoading) {
        const isSameNote = deps.editorScheduler.getLastRenderedNoteId() === state.selectedNoteId;
        if (!isSameNote) {
          deps.editorScheduler.schedule(state.selectedNoteId, state.content);
        } else if (!deps.isEditorFocused() && state.content !== deps.editorScheduler.getLastRenderedContent()) {
          deps.editorScheduler.schedule(state.selectedNoteId, state.content);
        }
      }
    }
  };

  return {
    render,
  };
};
