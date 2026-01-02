import { createIcon } from "./icons";

export type AppLayout = {
  root: HTMLElement;
  loading: HTMLDivElement;
  app: HTMLDivElement;
  sidebar: HTMLDivElement;
  sidebarInner: HTMLDivElement;
  sidebarHost: HTMLDivElement;
  sidebarResize: HTMLDivElement;
  list: HTMLDivElement;
  listHost: HTMLDivElement;
  listResize: HTMLDivElement;
  editorPane: HTMLDivElement;
  editorShell: HTMLDivElement;
  titleInput: HTMLInputElement;
  editorHost: HTMLDivElement;
  emptyState: HTMLDivElement;
  setLoaded: (loaded: boolean) => void;
  setWidths: (sidebarWidth: number, listWidth: number) => void;
  setNoteVisible: (hasNote: boolean) => void;
  setEditorLoadingVisible: (visible: boolean) => void;
  destroy: () => void;
};

type AppLayoutHandlers = {
  onSearch: () => void;
  onNewNote: () => void;
};

export const createAppLayout = (root: HTMLElement, handlers: AppLayoutHandlers): AppLayout => {
  const loading = document.createElement("div");
  loading.className = "app-loading";
  const loadingSpinner = document.createElement("div");
  loadingSpinner.className = "app-loading__spinner";
  loading.appendChild(loadingSpinner);
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
  searchButton.addEventListener("click", handlers.onSearch);
  sidebarInner.appendChild(searchButton);

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "btn btn--primary btn--pill btn--full btn--new-note";
  const plusIcon = createIcon("icon-plus", "btn__icon");
  newNoteButton.appendChild(plusIcon);
  const newNoteLabel = document.createElement("span");
  newNoteLabel.textContent = "New Note";
  newNoteButton.appendChild(newNoteLabel);
  newNoteButton.addEventListener("click", handlers.onNewNote);
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

  const titleBar = document.createElement("div");
  titleBar.className = "app-shell__titlebar";
  editorShell.appendChild(titleBar);

  const titleInput = document.createElement("input");
  titleInput.className = "app-shell__title-input";
  titleInput.placeholder = "Title";
  titleBar.appendChild(titleInput);

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host app-shell__editor-host";
  editorShell.appendChild(editorHost);

  const emptyState = document.createElement("div");
  emptyState.className = "app-shell__empty";
  const emptyIcon = createIcon("icon-file", "app-shell__empty-icon");
  emptyState.appendChild(emptyIcon);
  const emptyText = document.createElement("p");
  emptyText.className = "app-shell__empty-text";
  emptyText.textContent = "Select a note";
  emptyState.appendChild(emptyText);
  editorPane.appendChild(emptyState);

  const editorLoading = document.createElement("div");
  editorLoading.className = "editor-loading";
  const editorSpinner = document.createElement("div");
  editorSpinner.className = "editor-loading__spinner";
  editorLoading.appendChild(editorSpinner);
  editorHost.appendChild(editorLoading);

  const setLoaded = (loaded: boolean) => {
    loading.style.display = loaded ? "none" : "block";
    app.style.display = loaded ? "flex" : "none";
  };

  const setWidths = (sidebarWidth: number, listWidth: number) => {
    sidebar.style.width = `${sidebarWidth}px`;
    list.style.width = `${listWidth}px`;
  };

  const setNoteVisible = (hasNote: boolean) => {
    editorShell.style.display = hasNote ? "flex" : "none";
    emptyState.style.display = hasNote ? "none" : "flex";
  };

  const setEditorLoadingVisible = (visible: boolean) => {
    editorLoading.style.display = visible ? "flex" : "none";
  };

  const destroy = () => {
    root.removeChild(app);
    root.removeChild(loading);
  };

  return {
    root,
    loading,
    app,
    sidebar,
    sidebarInner,
    sidebarHost,
    sidebarResize,
    list,
    listHost,
    listResize,
    editorPane,
    editorShell,
    titleInput,
    editorHost,
    emptyState,
    setLoaded,
    setWidths,
    setNoteVisible,
    setEditorLoadingVisible,
    destroy,
  };
};
