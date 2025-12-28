import { openNoteContextMenu, openNotebookContextMenu, openTagContextMenu, type ContextMenuNode } from "./contextMenu";
import { mountEditor, type EditorInstance } from "./editor";
import { createIcon } from "./icons";
import { mountMetaBar } from "./metaBar";
import { mountNotesList, type NotesListHandlers, type NotesListInstance, type NotesListState } from "./notesList";
import { mountSearchModal } from "./searchModal";
import { mountSidebar, type SidebarHandlers, type SidebarInstance, type SidebarState } from "./sidebar";
import { mountTagsBar } from "./tagsBar";
import { createEditorScheduler } from "./editorScheduler";
import { actions, initApp } from "../controllers/appController";
import { startOcrQueue } from "../services/ocr";
import { appStore } from "../state/store";


const buildMenuNodes = (parentId: number | null, state: ReturnType<typeof appStore.getState>): ContextMenuNode[] => {
  const typeFilter = parentId === null ? "stack" : "notebook";
  const children = state.notebooks
    .filter((nb) => nb.parentId === parentId && nb.notebookType === typeFilter)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
  return children.map((nb) => ({
    id: nb.id,
    name: nb.name,
    type: nb.notebookType,
    children: nb.notebookType === "stack" ? buildMenuNodes(nb.id, state) : [],
  }));
};



export const mountApp = (root: HTMLElement) => {
  const loading = document.createElement("div");
  loading.className = "app-loading";
  root.appendChild(loading);

  const app = document.createElement("div");
  app.className = "app-shell";
  app.style.display = "none";
  root.appendChild(app);

  const sidebar = document.createElement("div");
  sidebar.className = "app-shell__sidebar";
  app.appendChild(sidebar);

  const sidebarInner = document.createElement("div");
  sidebarInner.className = "app-shell__sidebar-inner";
  sidebar.appendChild(sidebarInner);

  const searchButton = document.createElement("button");
  searchButton.className = "btn btn--secondary btn--pill btn--full btn--search";
  const searchIcon = createIcon("icon-search", "btn__icon");
  searchButton.appendChild(searchIcon);
  const searchLabel = document.createElement("span");
  searchLabel.textContent = "Search";
  searchButton.appendChild(searchLabel);
  sidebarInner.appendChild(searchButton);

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "btn btn--primary btn--pill btn--full btn--new-note";
  const plusIcon = createIcon("icon-plus", "btn__icon");
  newNoteButton.appendChild(plusIcon);
  const newNoteLabel = document.createElement("span");
  newNoteLabel.textContent = "New Note";
  newNoteButton.appendChild(newNoteLabel);
  newNoteButton.addEventListener("click", () => actions.createNote());
  sidebarInner.appendChild(newNoteButton);

  const sidebarHost = document.createElement("div");
  sidebarHost.className = "app-shell__sidebar-host";
  sidebarInner.appendChild(sidebarHost);

  const sidebarResize = document.createElement("div");
  sidebarResize.className = "app-shell__resize-handle";
  sidebar.appendChild(sidebarResize);

  const list = document.createElement("div");
  list.className = "app-shell__list";
  app.appendChild(list);

  const listHost = document.createElement("div");
  listHost.className = "app-shell__list-host";
  list.appendChild(listHost);

  const listResize = document.createElement("div");
  listResize.className = "app-shell__resize-handle app-shell__resize-handle--list";
  list.appendChild(listResize);

  const editorPane = document.createElement("div");
  editorPane.className = "app-shell__editor";
  app.appendChild(editorPane);

  const editorShell = document.createElement("div");
  editorShell.className = "app-shell__editor-shell";
  editorPane.appendChild(editorShell);

  const metaBar = mountMetaBar(editorShell);

  const titleBar = document.createElement("div");
  titleBar.className = "app-shell__titlebar";
  editorShell.appendChild(titleBar);

  const titleInput = document.createElement("input");
  titleInput.className = "app-shell__title-input";
  titleInput.placeholder = "Title";
  titleInput.addEventListener("input", () => {
    if (appStore.getState().selectedNoteId) {
      actions.setTitle(titleInput.value);
    }
  });
  titleBar.appendChild(titleInput);

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host app-shell__editor-host";
  editorShell.appendChild(editorHost);

  const tagsBar = mountTagsBar(editorShell, {
    onAddTag: actions.addTagToNote,
    onRemoveTag: actions.removeNoteTag,
  });

  const searchModal = mountSearchModal(editorPane, {
    onOpenNote: (noteId, notebookId) => {
      const state = appStore.getState();
      if (notebookId !== null) {
        const notebook = state.notebooks.find((nb) => nb.id === notebookId);
        if (notebook?.parentId) {
          const nextExpanded = new Set(state.expandedNotebooks);
          nextExpanded.add(notebook.parentId);
          appStore.setState({ expandedNotebooks: nextExpanded });
        }
      }
      actions.selectNotebook(notebookId);
      actions.selectNote(noteId);
    },
  });

  const emptyState = document.createElement("div");
  emptyState.className = "app-shell__empty";
  const emptyIcon = createIcon("icon-file", "app-shell__empty-icon");
  emptyState.appendChild(emptyIcon);
  const emptyText = document.createElement("p");
  emptyText.className = "app-shell__empty-text";
  emptyText.textContent = "Select a note";
  emptyState.appendChild(emptyText);
  editorPane.appendChild(emptyState);

  const sidebarHandlers: SidebarHandlers = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onSelectTag: (id) => actions.selectTag(id),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onToggleTag: (id) => actions.toggleTag(id),
    onCreateNotebook: (parentId) => actions.createNotebook(parentId),
    onCreateTag: (parentId) => actions.createTag(parentId),
    onToggleTagsSection: () => actions.toggleTagsSection(),
    onCreateNoteInNotebook: (id) => actions.createNoteInNotebook(id),
    onDeleteNotebook: (id) => actions.deleteNotebook(id),
    onTagContextMenu: (event, id) => {
      event.preventDefault();
      openTagContextMenu({
        x: event.clientX,
        y: event.clientY,
        tagId: id,
        onDelete: actions.deleteTag,
      });
    },
    onNotebookContextMenu: (event, id) => {
      event.preventDefault();
      openNotebookContextMenu({
        x: event.clientX,
        y: event.clientY,
        notebookId: id,
        onDelete: actions.deleteNotebook,
      });
    },
    onMoveTag: (tagId, parentId) => actions.moveTag(tagId, parentId),
    onMoveNotebook: (activeId, overId, position) => actions.moveNotebookByDrag(activeId, overId, position),
  };

  const notesListHandlers: NotesListHandlers = {
    onSelectNote: (id) => actions.selectNote(id),
    onDeleteNote: (id) => actions.deleteNote(id),
    onSelectSort: (sortBy, sortDir) => actions.setNotesSort(sortBy, sortDir),
    onToggleView: () => {
      const state = appStore.getState();
      const next = state.notesListView === "compact" ? "detailed" : "compact";
      actions.setNotesListView(next);
    },
    onFilterClick: () => {},
    onNoteContextMenu: (event, id) => {
      event.preventDefault();
      const state = appStore.getState();
      const nodes = buildMenuNodes(null, state);
      openNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: id,
        nodes,
        onDelete: actions.deleteNote,
        onMove: actions.moveNoteToNotebook,
      });
    },
    onMoveNote: (noteId, notebookId) => actions.moveNoteToNotebook(noteId, notebookId),
  };

  const sidebarInstance: SidebarInstance = mountSidebar(sidebarHost, sidebarHandlers);
  const notesListInstance: NotesListInstance = mountNotesList(listHost, notesListHandlers);
  let editorFocused = false;
  const editorInstance: EditorInstance = mountEditor(editorHost, {
    content: "",
    onChange: actions.setContent,
    onFocus: () => {
      editorFocused = true;
    },
    onBlur: () => {
      editorFocused = false;
    },
  });
  const editorLoading = document.createElement("div");
  editorLoading.className = "editor-loading";
  const editorSpinner = document.createElement("div");
  editorSpinner.className = "editor-loading__spinner";
  editorLoading.appendChild(editorSpinner);
  editorHost.appendChild(editorLoading);
  const setEditorLoadingVisible = (visible: boolean) => {
    editorLoading.style.display = visible ? "flex" : "none";
  };
  let lastSidebarState: SidebarState | null = null;
  let lastNotesListState: NotesListState | null = null;
  const editorScheduler = createEditorScheduler({
    editor: editorInstance,
    getSelectedNoteId: () => appStore.getState().selectedNoteId,
  });
  searchButton.addEventListener("click", () => {
    searchModal.open();
  });

  let isResizingSidebar = false;
  let isResizingList = false;

  const handleMouseMove = (event: MouseEvent) => {
    const state = appStore.getState();
    if (isResizingSidebar) {
      actions.setSidebarWidth(Math.max(150, Math.min(450, event.clientX)));
    } else if (isResizingList) {
      actions.setListWidth(Math.max(200, Math.min(600, event.clientX - state.sidebarWidth)));
    }
  };

  const handleMouseUp = () => {
    isResizingSidebar = false;
    isResizingList = false;
  };

  sidebarResize.addEventListener("mousedown", () => {
    isResizingSidebar = true;
  });
  listResize.addEventListener("mousedown", () => {
    isResizingList = true;
  });
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);

  const render = () => {
    const state = appStore.getState();
    if (!state.isLoaded) {
      loading.style.display = "block";
      app.style.display = "none";
      return;
    }
    loading.style.display = "none";
    app.style.display = "flex";
    sidebar.style.width = `${state.sidebarWidth}px`;
    list.style.width = `${state.listWidth}px`;

    if (titleInput.value !== state.title) {
      titleInput.value = state.title;
    }

    const hasNote = !!state.selectedNoteId;
    setEditorLoadingVisible(hasNote && (state.isNoteLoading || editorScheduler.isUpdating()));
    editorShell.style.display = hasNote ? "flex" : "none";
    emptyState.style.display = hasNote ? "none" : "flex";
    metaBar.update({
      hasNote,
      notebooks: state.notebooks,
      selectedNotebookId: state.selectedNotebookId,
      activeNote: state.activeNote,
    });


    tagsBar.update({
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
      expandedNotebooks: state.expandedNotebooks,
      noteCounts: state.noteCounts,
      totalNotes: state.totalNotes,
    };

  const notesListState: NotesListState = {
    notes: state.notes,
    notebooks: state.notebooks,
    tags: state.tags,
    selectedNotebookId: state.selectedNotebookId,
    selectedTagId: state.selectedTagId,
    selectedNoteId: state.selectedNoteId,
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
      lastSidebarState.expandedNotebooks !== sidebarState.expandedNotebooks ||
      lastSidebarState.expandedTags !== sidebarState.expandedTags ||
      lastSidebarState.tagsSectionExpanded !== sidebarState.tagsSectionExpanded ||
      lastSidebarState.noteCounts !== sidebarState.noteCounts ||
      lastSidebarState.totalNotes !== sidebarState.totalNotes;

    if (shouldUpdateSidebar) {
      sidebarInstance.update(sidebarState);
      lastSidebarState = sidebarState;
    }

    const shouldUpdateList =
      !lastNotesListState ||
      lastNotesListState.notes !== notesListState.notes ||
      lastNotesListState.notebooks !== notesListState.notebooks ||
      lastNotesListState.tags !== notesListState.tags ||
      lastNotesListState.selectedNotebookId !== notesListState.selectedNotebookId ||
      lastNotesListState.selectedTagId !== notesListState.selectedTagId ||
      lastNotesListState.selectedNoteId !== notesListState.selectedNoteId ||
      lastNotesListState.notesListView !== notesListState.notesListView;

    if (shouldUpdateList) {
      notesListInstance.update(notesListState);
      lastNotesListState = notesListState;
    }
    if (hasNote) {
      const readyNote = state.activeNote && state.activeNote.id === state.selectedNoteId;
      if (readyNote && !state.isNoteLoading) {
        const isSameNote = editorScheduler.getLastRenderedNoteId() === state.selectedNoteId;
        if (!isSameNote) {
          editorScheduler.schedule(state.selectedNoteId, state.content);
        } else if (!editorFocused && state.content !== editorScheduler.getLastRenderedContent()) {
          editorScheduler.schedule(state.selectedNoteId, state.content);
        }
      }
    }
  };

  const unsubscribe = appStore.subscribe(render);
  render();

  let cleanupInit: (() => void) | undefined;
  let cleanupOcr: (() => void) | undefined;
  initApp().then((cleanup) => {
    cleanupInit = cleanup;
    cleanupOcr = startOcrQueue();
  });

  return () => {
    unsubscribe();
    cleanupInit?.();
    cleanupOcr?.();
    sidebarInstance.destroy();
    notesListInstance.destroy();
    editorInstance.destroy();
    editorScheduler.reset();
    searchModal.destroy();
    metaBar.destroy();
    tagsBar.destroy();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    root.removeChild(app);
    root.removeChild(loading);
  };
};
