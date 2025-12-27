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

  const metaBar = document.createElement("div");
  metaBar.className = "app-shell__meta";
  const metaStackIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  metaStackIcon.setAttribute("viewBox", "0 0 64 64");
  metaStackIcon.setAttribute("fill", "currentColor");
  metaStackIcon.setAttribute("class", "app-shell__meta-icon");
  metaStackIcon.setAttribute("aria-hidden", "true");
  metaStackIcon.innerHTML = `
    <path d="M62.9994125,39.4741516h-1.9568176c-2.3530006-5.0440025-2.3532982-9.9673023,0-15.0459023h1.9568176
      c0.5526848,0,1-0.4477997,1-1c0-0.5522995-0.4473152-1-1-1H25.8977966v-0.7432003h31.9053001c0.5527,0,1-0.4476986,1-1
      c0-0.5521984-0.4473-1-1-1h-1.9568024c-2.3532982-5.0436993-2.3522987-9.9664993,0.0003014-15.0463991h1.956501
      c0.5527,0,1-0.4477,1-1c0-0.5521998-0.4473-1-1-1H5.2444973c-0.3632998,0-0.6981997,0.1973-0.875,0.5152001
      C0.7366974,9.70895,0.7522975,15.7949495,4.414412,21.2431507c0.1855855,0.2763996,0.4970856,0.4418983,0.8300853,0.4418983
      h10.1299143v0.7432003h-4.9336147c-0.3632994,0-0.6981993,0.1972008-0.875,0.5151005
      C5.9319973,29.4980507,5.9475975,35.58395,9.6106968,41.0322495c0.1856003,0.2763023,0.4971008,0.4419022,0.8301001,0.4419022
      h52.5586166c0.5526848,0,1-0.4478035,1-1C63.9994125,39.9218483,63.5520973,39.4741516,62.9994125,39.4741516z
       M17.3744125,11.6435499h6.5233841v17.3358994l-2.8486004-1.2915001c-0.2636986-0.1191006-0.5625-0.1191006-0.8261986,0
      l-2.8485851,1.2915001V11.6435499z M5.7874975,19.6850491c-2.875-4.5765991-2.8574002-9.5087986,0.0537-15.0463991h47.8217964
      c-2.0849991,5.0116997-2.0861969,10.0642004-0.0029984,15.0463991H25.8977966v-8.0414991h16.0458984c0.552803,0,1-0.4476995,1-1
      c0-0.5522003-0.447197-1-1-1H12.1126976c-0.5528002,0-1,0.4477997-1,1c0,0.5523005,0.4471998,1,1,1h3.261714v8.0414991H5.7874975z
       M11.0374975,24.4282494h4.3369141v6.1025009c0,0.3398991,0.1727858,0.6562996,0.4580002,0.8402996
      c0.2860861,0.1846008,0.6464853,0.2115002,0.9550848,0.0704002l3.8486004-1.7446995l3.8486004,1.7446995
      c0.1318989,0.0599995,0.2724991,0.0893002,0.4130993,0.0893002c0.1895008,0,0.3780003-0.0536995,0.5419998-0.1597004
      c0.2852001-0.184,0.4580002-0.5004005,0.4580002-0.8402996v-6.1025009h32.9612007
      c-2.085701,5.0107002-2.0862007,10.0629997-0.0023994,15.0459023H10.9827976
      C8.1077976,34.8974495,8.125412,29.9658508,11.0374975,24.4282494z"/>
    <path d="M54.1919975,44.3154488h1.9567986c0.5527,0,1-0.4477997,1-1c0-0.5522995-0.4473-1-1-1H3.5901973
      c-0.3632998,0-0.6982,0.1972008-0.875,0.5151024c-3.6346998,6.5546989-3.6190999,12.6405983,0.0449002,18.0888977
      c0.1866,0.2764015,0.4970999,0.4419022,0.8300998,0.4419022h52.5585976c0.5527,0,1-0.4477997,1-1c0-0.5522995-0.4473-1-1-1
      h-1.9567986C51.8389969,54.3168488,51.8387947,49.3940506,54.1919975,44.3154488z M4.1321974,59.361351
      c-2.8759999-4.5767021-2.8583999-9.5088005,0.0546999-15.0459023h47.8215141
      c-2.0857162,5.0107002-2.0859146,10.0627022-0.0024147,15.0459023H4.1321974z"/>
  `;
  const metaStackText = document.createElement("span");
  metaStackText.className = "app-shell__meta-text";
  const metaSep = document.createElement("span");
  metaSep.className = "app-shell__meta-sep";
  metaSep.textContent = "|";
  const metaNotebookIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  metaNotebookIcon.setAttribute("viewBox", "0 0 512 512");
  metaNotebookIcon.setAttribute("fill", "currentColor");
  metaNotebookIcon.setAttribute("class", "app-shell__meta-icon");
  metaNotebookIcon.setAttribute("aria-hidden", "true");
  metaNotebookIcon.innerHTML = `
    <path d="M465.544,0H78.447c-5.632,0-10.199,4.567-10.199,10.199v32.456H46.456c-5.632,0-10.199,4.567-10.199,10.199
      s4.567,10.199,10.199,10.199h21.792v79.841H46.456c-5.632,0-10.199,4.567-10.199,10.199s4.567,10.199,10.199,10.199h21.792v79.84
      H46.456c-5.632,0-10.199,4.567-10.199,10.199c0,5.632,4.567,10.199,10.199,10.199h21.792v79.841H46.456
      c-5.632,0-10.199,4.567-10.199,10.199c0,5.632,4.567,10.199,10.199,10.199h21.792v79.841H46.456
      c-5.632,0-10.199,4.567-10.199,10.199s4.567,10.199,10.199,10.199h21.792v37.789c0,5.632,4.567,10.199,10.199,10.199h387.096
      c5.632,0,10.199-4.567,10.199-10.199V10.199C475.743,4.567,471.176,0,465.544,0z M138.63,491.602H88.646v-27.589h21.793
      c5.632,0,10.199-4.567,10.199-10.199c0-5.632-4.567-10.199-10.199-10.199H88.646v-79.841h21.793
      c5.632,0,10.199-4.567,10.199-10.199s-4.567-10.199-10.199-10.199H88.646v-79.841h21.793c5.632,0,10.199-4.567,10.199-10.199
      s-4.567-10.199-10.199-10.199H88.646v-79.84h21.793c5.632,0,10.199-4.567,10.199-10.199c0-5.632-4.567-10.199-10.199-10.199
      H88.646V63.054h21.793c5.632,0,10.199-4.567,10.199-10.199s-4.567-10.199-10.199-10.199H88.646V20.398h49.983V491.602z
       M455.344,491.602H159.028V20.398h296.316V491.602z"/>
    <path d="M390.66,79.978H223.713c-5.632,0-10.199,4.567-10.199,10.199v105.572c0,5.632,4.566,10.199,10.199,10.199H390.66
      c5.632,0,10.199-4.567,10.199-10.199V90.177C400.859,84.545,396.292,79.978,390.66,79.978z M380.461,185.55H233.913v-85.174
      h146.548V185.55z"/>
    <path d="M354.641,117.302h-7.465c-5.632,0-10.199,4.567-10.199,10.199c0,5.632,4.567,10.199,10.199,10.199h7.465
      c5.632,0,10.199-4.567,10.199-10.199C364.84,121.869,360.273,117.302,354.641,117.302z"/>
    <path d="M313.052,117.302h-51.187c-5.632,0-10.199,4.567-10.199,10.199c0,5.632,4.567,10.199,10.199,10.199h51.187
      c5.632,0,10.199-4.567,10.199-10.199C323.252,121.869,318.684,117.302,313.052,117.302z"/>
  `;
  const metaNotebookText = document.createElement("span");
  metaNotebookText.className = "app-shell__meta-text";
  const metaUpdated = document.createElement("span");
  metaUpdated.className = "app-shell__meta-updated";
  metaBar.appendChild(metaStackIcon);
  metaBar.appendChild(metaStackText);
  metaBar.appendChild(metaSep);
  metaBar.appendChild(metaNotebookIcon);
  metaBar.appendChild(metaNotebookText);
  metaBar.appendChild(metaUpdated);
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
      if (state.activeNote?.updatedAt) {
        const date = new Date(state.activeNote.updatedAt * 1000);
        const formatted = date.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        metaUpdated.textContent = `Last edited on ${formatted}`;
      } else {
        metaUpdated.textContent = "";
      }
      metaSep.classList.toggle("is-hidden", !stack);
      metaStackIcon.classList.toggle("is-hidden", !stack);
      metaStackText.classList.toggle("is-hidden", !stack);
      metaNotebookIcon.classList.toggle("is-hidden", !notebook);
      metaNotebookText.classList.toggle("is-hidden", !notebook);
    } else {
      metaSep.classList.add("is-hidden");
      metaStackIcon.classList.add("is-hidden");
      metaStackText.classList.add("is-hidden");
      metaNotebookIcon.classList.add("is-hidden");
      metaNotebookText.classList.add("is-hidden");
      metaStackText.textContent = "";
      metaNotebookText.textContent = "";
      metaUpdated.textContent = "";
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
