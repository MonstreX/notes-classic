import { openNoteContextMenu, openNotebookContextMenu, type ContextMenuNode } from "./contextMenu";
import { mountEditor, type EditorInstance } from "./editor";
import { mountNotesList, type NotesListHandlers, type NotesListInstance, type NotesListState } from "./notesList";
import { mountSidebar, type SidebarHandlers, type SidebarInstance, type SidebarState } from "./sidebar";
import { actions, initApp } from "./appController";
import { appStore } from "./store";

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

const createIcon = (path: string, className: string) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", className);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
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
  const searchIcon = createIcon(
    "M11 4a7 7 0 1 0 4.9 12l4.3 4.3 1.4-1.4-4.3-4.3A7 7 0 0 0 11 4z",
    "btn__icon"
  );
  searchButton.appendChild(searchIcon);
  const searchLabel = document.createElement("span");
  searchLabel.textContent = "Search";
  searchButton.appendChild(searchLabel);
  sidebarInner.appendChild(searchButton);

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "btn btn--primary btn--pill btn--full btn--new-note";
  const plusIcon = createIcon("M12 5v14M5 12h14", "btn__icon");
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
  editorShell.style.position = "relative";

  const metaBar = document.createElement("div");
  metaBar.className = "app-shell__meta";
  const metaStackIcon = createIcon(
    "M2 7h20M2 12h20M2 17h20",
    "app-shell__meta-icon"
  );
  const metaStackText = document.createElement("span");
  metaStackText.className = "app-shell__meta-text";
  const metaSep = document.createElement("span");
  metaSep.className = "app-shell__meta-sep";
  metaSep.textContent = "|";
  const metaNotebookIcon = createIcon(
    "M4 19.5A2.5 2.5 0 0 0 6.5 22H20M4 2h16v20H4z",
    "app-shell__meta-icon"
  );
  const metaNotebookText = document.createElement("span");
  metaNotebookText.className = "app-shell__meta-text";
  metaBar.appendChild(metaStackIcon);
  metaBar.appendChild(metaStackText);
  metaBar.appendChild(metaSep);
  metaBar.appendChild(metaNotebookIcon);
  metaBar.appendChild(metaNotebookText);
  editorShell.appendChild(metaBar);

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

  const searchOverlay = document.createElement("div");
  searchOverlay.className = "search-modal";
  searchOverlay.style.display = "none";
  const searchPanel = document.createElement("div");
  searchPanel.className = "search-modal__panel";
  const searchTitle = document.createElement("div");
  searchTitle.className = "search-modal__title";
  searchTitle.textContent = "Search";
  const searchField = document.createElement("div");
  searchField.className = "search-modal__field";
  const searchInput = document.createElement("input");
  searchInput.className = "search-modal__input";
  searchInput.type = "text";
  searchInput.placeholder = "Search...";
  searchField.appendChild(searchInput);
  searchPanel.appendChild(searchTitle);
  searchPanel.appendChild(searchField);
  searchOverlay.appendChild(searchPanel);
  editorPane.appendChild(searchOverlay);

  const emptyState = document.createElement("div");
  emptyState.className = "app-shell__empty";
  const emptyIcon = createIcon("M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v6h6", "app-shell__empty-icon");
  emptyState.appendChild(emptyIcon);
  const emptyText = document.createElement("p");
  emptyText.className = "app-shell__empty-text";
  emptyText.textContent = "Select a note";
  emptyState.appendChild(emptyText);
  editorPane.appendChild(emptyState);

  const sidebarHandlers: SidebarHandlers = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onCreateNotebook: (parentId) => actions.createNotebook(parentId),
    onCreateNoteInNotebook: (id) => actions.createNoteInNotebook(id),
    onDeleteNotebook: (id) => actions.deleteNotebook(id),
    onNotebookContextMenu: (event, id) => {
      event.preventDefault();
      openNotebookContextMenu({
        x: event.clientX,
        y: event.clientY,
        notebookId: id,
        onDelete: actions.deleteNotebook,
      });
    },
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
  let lastRenderedNoteId: number | null = null;
  let lastRenderedContent = "";
  let lastSidebarState: SidebarState | null = null;
  let lastNotesListState: NotesListState | null = null;
  let pendingEditorUpdate: number | null = null;
  let pendingEditorNoteId: number | null = null;
  let pendingEditorContent = "";
  let isEditorUpdating = false;
  let isSearchOpen = false;

  const setEditorLoadingVisible = (visible: boolean) => {
    editorLoading.style.display = visible ? "flex" : "none";
  };

  const setSearchVisible = (visible: boolean) => {
    isSearchOpen = visible;
    searchOverlay.style.display = visible ? "flex" : "none";
    if (visible) {
      const state = appStore.getState();
      searchInput.value = state.searchTerm;
      window.setTimeout(() => {
        searchInput.focus();
        searchInput.select();
      }, 0);
    }
  };

  searchButton.addEventListener("click", () => {
    setSearchVisible(true);
  });

  searchOverlay.addEventListener("click", (event) => {
    if (event.target === searchOverlay) {
      setSearchVisible(false);
    }
  });

  searchInput.addEventListener("input", () => {
    actions.setSearchTerm(searchInput.value);
  });

  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isSearchOpen) {
      setSearchVisible(false);
    }
  };
  window.addEventListener("keydown", handleSearchKeydown);

  const scheduleEditorUpdate = (noteId: number | null, content: string) => {
    if (pendingEditorUpdate !== null) {
      window.clearTimeout(pendingEditorUpdate);
      pendingEditorUpdate = null;
    }
    pendingEditorNoteId = noteId;
    pendingEditorContent = content;
    isEditorUpdating = true;
    if (noteId !== null) {
      setEditorLoadingVisible(true);
    }
    pendingEditorUpdate = window.setTimeout(() => {
      pendingEditorUpdate = null;
      const current = appStore.getState();
      if (current.selectedNoteId !== pendingEditorNoteId) {
        isEditorUpdating = false;
        if (current.selectedNoteId === null) {
          setEditorLoadingVisible(false);
        }
        return;
      }
      try {
        editorInstance.update(pendingEditorContent);
        lastRenderedNoteId = pendingEditorNoteId;
        lastRenderedContent = pendingEditorContent;
      } catch (e) {
        console.error("[editor] update failed", e);
      } finally {
        isEditorUpdating = false;
        setEditorLoadingVisible(current.isNoteLoading);
      }
    }, 0);
  };

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
    setEditorLoadingVisible(hasNote && (state.isNoteLoading || isEditorUpdating));
    editorShell.style.display = hasNote ? "flex" : "none";
    emptyState.style.display = hasNote ? "none" : "flex";
    if (hasNote && state.selectedNotebookId !== null) {
      const notebook = state.notebooks.find((nb) => nb.id === state.selectedNotebookId);
      const stack = notebook?.parentId ? state.notebooks.find((nb) => nb.id === notebook.parentId) : null;
      metaStackText.textContent = stack?.name ?? "";
      metaNotebookText.textContent = notebook?.name ?? "";
      metaSep.style.display = stack ? "inline" : "none";
      metaStackIcon.style.display = stack ? "inline-flex" : "none";
      metaStackText.style.display = stack ? "inline" : "none";
      metaNotebookIcon.style.display = notebook ? "inline-flex" : "none";
      metaNotebookText.style.display = notebook ? "inline" : "none";
      metaBar.style.display = notebook ? "flex" : "none";
    } else {
      metaBar.style.display = "none";
    }

    const sidebarState: SidebarState = {
      notebooks: state.notebooks,
      selectedNotebookId: state.selectedNotebookId,
      expandedNotebooks: state.expandedNotebooks,
      noteCounts: state.noteCounts,
      totalNotes: state.totalNotes,
    };

  const notesListState: NotesListState = {
    notes: state.notes,
    notebooks: state.notebooks,
    selectedNotebookId: state.selectedNotebookId,
    selectedNoteId: state.selectedNoteId,
    notesListView: state.notesListView,
    searchTerm: state.searchTerm,
    notesSortBy: state.notesSortBy,
    notesSortDir: state.notesSortDir,
  };

    const shouldUpdateSidebar =
      !lastSidebarState ||
      lastSidebarState.notebooks !== sidebarState.notebooks ||
      lastSidebarState.selectedNotebookId !== sidebarState.selectedNotebookId ||
      lastSidebarState.expandedNotebooks !== sidebarState.expandedNotebooks ||
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
      lastNotesListState.selectedNotebookId !== notesListState.selectedNotebookId ||
      lastNotesListState.selectedNoteId !== notesListState.selectedNoteId ||
      lastNotesListState.notesListView !== notesListState.notesListView ||
      lastNotesListState.searchTerm !== notesListState.searchTerm;

    if (shouldUpdateList) {
      notesListInstance.update(notesListState);
      lastNotesListState = notesListState;
    }
    if (hasNote) {
      const readyNote = state.activeNote && state.activeNote.id === state.selectedNoteId;
      if (readyNote && !state.isNoteLoading) {
        const isSameNote = lastRenderedNoteId === state.selectedNoteId;
        if (!isSameNote) {
          scheduleEditorUpdate(state.selectedNoteId, state.content);
        } else if (!editorFocused && state.content !== lastRenderedContent) {
          scheduleEditorUpdate(state.selectedNoteId, state.content);
        }
      }
    }
  };

  const unsubscribe = appStore.subscribe(render);
  render();

  let cleanupInit: (() => void) | undefined;
  initApp().then((cleanup) => {
    cleanupInit = cleanup;
  });

  return () => {
    unsubscribe();
    cleanupInit?.();
    sidebarInstance.destroy();
    notesListInstance.destroy();
    editorInstance.destroy();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("keydown", handleSearchKeydown);
    root.removeChild(app);
    root.removeChild(loading);
  };
};
