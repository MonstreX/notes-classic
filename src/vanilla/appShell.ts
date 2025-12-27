import { openNoteContextMenu, type ContextMenuNode } from "./contextMenu";
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

  const brandRow = document.createElement("div");
  brandRow.className = "brand";
  sidebarInner.appendChild(brandRow);

  const brandIcon = document.createElement("div");
  brandIcon.className = "brand__icon";
  brandIcon.textContent = "M";
  brandRow.appendChild(brandIcon);

  const brandText = document.createElement("span");
  brandText.className = "brand__text";
  brandText.textContent = "Notes Classic";
  brandRow.appendChild(brandText);

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "btn btn--primary btn--pill btn--new-note";
  const plusIcon = createIcon("M12 5v14M5 12h14", "w-5 h-5");
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
  list.className = "border-r border-gray-200 bg-white flex flex-col shrink-0 relative text-black";
  app.appendChild(list);

  const listHost = document.createElement("div");
  listHost.className = "flex-1 min-h-0 overflow-hidden";
  list.appendChild(listHost);

  const listResize = document.createElement("div");
  listResize.className = "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors";
  list.appendChild(listResize);

  const editorPane = document.createElement("div");
  editorPane.className = "flex-1 flex flex-col bg-white overflow-hidden text-black min-h-0";
  app.appendChild(editorPane);

  const editorShell = document.createElement("div");
  editorShell.className = "flex flex-col h-full";
  editorPane.appendChild(editorShell);

  const titleBar = document.createElement("div");
  titleBar.className = "px-10 py-6 shrink-0 bg-white shadow-sm z-10";
  editorShell.appendChild(titleBar);

  const titleInput = document.createElement("input");
  titleInput.className = "w-full text-4xl font-light border-none focus:ring-0 outline-none";
  titleInput.placeholder = "Title";
  titleInput.addEventListener("input", () => {
    if (appStore.getState().selectedNoteId) {
      actions.setTitle(titleInput.value);
    }
  });
  titleBar.appendChild(titleInput);

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host flex-1 overflow-hidden min-h-0";
  editorShell.appendChild(editorHost);

  const emptyState = document.createElement("div");
  emptyState.className = "flex-1 flex flex-col items-center justify-center text-gray-400";
  const emptyIcon = createIcon("M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v6h6", "w-20 h-20 mb-6 text-gray-100");
  emptyState.appendChild(emptyIcon);
  const emptyText = document.createElement("p");
  emptyText.className = "text-lg font-light";
  emptyText.textContent = "Select a note";
  emptyState.appendChild(emptyText);
  editorPane.appendChild(emptyState);

  const sidebarHandlers: SidebarHandlers = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onCreateNotebook: (parentId) => actions.createNotebook(parentId),
    onDeleteNotebook: (id) => actions.deleteNotebook(id),
    onMoveNotebook: (activeId, overId, position) => actions.moveNotebookByDrag(activeId, overId, position),
  };

  const notesListHandlers: NotesListHandlers = {
    onSelectNote: (id) => actions.selectNote(id),
    onDeleteNote: (id) => actions.deleteNote(id),
    onSearchChange: (value) => actions.setSearchTerm(value),
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

  const setEditorLoadingVisible = (visible: boolean) => {
    editorLoading.style.display = visible ? "flex" : "none";
  };

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
    root.removeChild(app);
    root.removeChild(loading);
  };
};
