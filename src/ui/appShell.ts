import { openNoteContextMenu, openNotebookContextMenu, openTagContextMenu, type ContextMenuNode } from "./contextMenu";
import { mountEditor, mountPreviewEditor, type EditorInstance } from "./editor";
import { mountNotesList, type NotesListHandlers, type NotesListInstance, type NotesListState } from "./notesList";
import { mountSidebar, type SidebarHandlers, type SidebarInstance, type SidebarState } from "./sidebar";
import { actions, initApp } from "../controllers/appController";
import { appStore } from "../state/store";
import type { Tag } from "../state/types";
import { ensureNotesScheme, normalizeEnmlContent, toDisplayContent } from "../services/content";
import { getNote, searchNotes } from "../services/notes";

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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const createIcon = (id: string, className: string) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
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

  const metaBar = document.createElement("div");
  metaBar.className = "app-shell__meta";
  const metaStackIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  metaStackIcon.setAttribute("class", "app-shell__meta-icon");
  metaStackIcon.setAttribute("aria-hidden", "true");
  const metaStackUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
  metaStackUse.setAttribute("href", "#icon-stack");
  metaStackIcon.appendChild(metaStackUse);
  const metaStackText = document.createElement("span");
  metaStackText.className = "app-shell__meta-text";
  const metaSep = document.createElement("span");
  metaSep.className = "app-shell__meta-sep";
  metaSep.textContent = "|";
  const metaNotebookIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  metaNotebookIcon.setAttribute("class", "app-shell__meta-icon");
  metaNotebookIcon.setAttribute("aria-hidden", "true");
  const metaNotebookUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
  metaNotebookUse.setAttribute("href", "#icon-notebook");
  metaNotebookIcon.appendChild(metaNotebookUse);
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

  const tagsBar = document.createElement("div");
  tagsBar.className = "app-shell__tags";
  const tagsIcon = createIcon("icon-tag", "app-shell__tags-icon");
  const tagsList = document.createElement("div");
  tagsList.className = "app-shell__tags-list";
  const tagsInputWrap = document.createElement("div");
  tagsInputWrap.className = "app-shell__tags-input";
  const tagsSuggest = document.createElement("div");
  tagsSuggest.className = "app-shell__tags-suggest";
  const tagsInput = document.createElement("input");
  tagsInput.className = "app-shell__tags-field";
  tagsInput.type = "text";
  tagsInput.placeholder = "Add tag...";
  tagsInputWrap.appendChild(tagsSuggest);
  tagsInputWrap.appendChild(tagsInput);
  tagsBar.appendChild(tagsIcon);
  tagsBar.appendChild(tagsList);
  tagsBar.appendChild(tagsInputWrap);
  editorShell.appendChild(tagsBar);

  const searchOverlay = document.createElement("div");
  searchOverlay.className = "search-modal";
  searchOverlay.style.display = "none";
  const searchPanel = document.createElement("div");
  searchPanel.className = "search-modal__panel";
  const searchHeader = document.createElement("div");
  searchHeader.className = "search-modal__header";
  const searchTitle = document.createElement("div");
  searchTitle.className = "search-modal__title";
  searchTitle.textContent = "Search";
  const searchClose = document.createElement("button");
  searchClose.className = "search-modal__close";
  searchClose.type = "button";
  searchClose.setAttribute("aria-label", "Close");
  const searchCloseIcon = createIcon("icon-close", "search-modal__close-icon");
  searchClose.appendChild(searchCloseIcon);
  searchHeader.appendChild(searchTitle);
  searchHeader.appendChild(searchClose);
  const searchField = document.createElement("div");
  searchField.className = "search-modal__field";
  const searchInput = document.createElement("input");
  searchInput.className = "search-modal__input";
  searchInput.type = "text";
  searchInput.placeholder = "Search...";
  const searchFieldIcon = createIcon("icon-search", "search-modal__icon");
  const searchSubmit = document.createElement("button");
  searchSubmit.className = "search-modal__button";
  searchSubmit.type = "button";
  searchSubmit.textContent = "Search";
  searchField.appendChild(searchFieldIcon);
  searchField.appendChild(searchInput);
  searchField.appendChild(searchSubmit);
  searchPanel.appendChild(searchHeader);
  searchPanel.appendChild(searchField);
  const searchLoading = document.createElement("div");
  searchLoading.className = "search-modal__loading";
  const searchLoadingSpinner = document.createElement("div");
  searchLoadingSpinner.className = "search-modal__spinner";
  const searchLoadingText = document.createElement("div");
  searchLoadingText.className = "search-modal__loading-text";
  searchLoadingText.textContent = "Searching...";
  searchLoading.appendChild(searchLoadingSpinner);
  searchLoading.appendChild(searchLoadingText);
  searchPanel.appendChild(searchLoading);
  const searchOptions = document.createElement("div");
  searchOptions.className = "search-modal__options";
  const searchEverywhere = document.createElement("button");
  searchEverywhere.type = "button";
  searchEverywhere.className = "search-modal__toggle";
  const searchEverywhereIcon = createIcon("icon-note", "search-modal__toggle-icon");
  searchEverywhere.appendChild(searchEverywhereIcon);
  const searchEverywhereText = document.createElement("span");
  searchEverywhereText.textContent = "Search everywhere";
  searchEverywhere.appendChild(searchEverywhereText);
  const searchScope = document.createElement("div");
  searchScope.className = "search-modal__scope";
  searchOptions.appendChild(searchEverywhere);
  searchOptions.appendChild(searchScope);
  searchPanel.appendChild(searchOptions);
  const searchResults = document.createElement("div");
  searchResults.className = "search-modal__results";
  const searchPreview = document.createElement("div");
  searchPreview.className = "search-modal__preview";
  const searchPreviewBody = document.createElement("div");
  searchPreviewBody.className = "search-modal__preview-body";
  searchPreview.appendChild(searchPreviewBody);
  searchPanel.appendChild(searchResults);
  searchPanel.appendChild(searchPreview);
  const searchEmpty = document.createElement("div");
  searchEmpty.className = "search-modal__empty-state";
  const searchEmptyIcon = createIcon("icon-search", "search-modal__empty-icon");
  const searchEmptyText = document.createElement("div");
  searchEmptyText.className = "search-modal__empty-text";
  searchEmptyText.textContent = "No results found";
  searchEmpty.appendChild(searchEmptyIcon);
  searchEmpty.appendChild(searchEmptyText);
  searchPanel.appendChild(searchEmpty);
  searchOverlay.appendChild(searchPanel);
  editorPane.appendChild(searchOverlay);

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
  let lastRenderedNoteId: number | null = null;
  let lastRenderedContent = "";
  let lastSidebarState: SidebarState | null = null;
  let lastNotesListState: NotesListState | null = null;
  let pendingEditorUpdate: number | null = null;
  let pendingEditorNoteId: number | null = null;
  let pendingEditorContent = "";
  let isEditorUpdating = false;
  let isSearchOpen = false;
  let searchEverywhereActive = false;
  let searchScopeNotebookId: number | null = null;
  let searchScopeLabel = "All Notes";
  let searchResultsData: NotesListState["notes"] = [];
  let searchSelectedNoteId: number | null = null;
  let searchTokens: string[] = [];
  let searchHasRun = false;
  let searchLoadingTimer: number | null = null;
  let searchRunToken = 0;
  let searchPreviewEditor: EditorInstance | null = null;
  let tagSuggestions: Tag[] = [];
  let tagSuggestIndex = 0;

  const buildTagPath = (tag: Tag, map: Map<number, Tag>) => {
    const parts = [tag.name];
    let current = tag;
    while (current.parentId) {
      const parent = map.get(current.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" / ");
  };

  const updateTagSuggestions = (preserveIndex = false) => {
    const state = appStore.getState();
    const query = tagsInput.value.trim().toLowerCase();
    const assigned = new Set(state.noteTags.map((tag) => tag.id));
    if (query.length < 2) {
      tagSuggestions = [];
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
      return;
    }
    tagSuggestions = state.tags
      .filter((tag) => !assigned.has(tag.id))
      .filter((tag) => tag.name.toLowerCase().startsWith(query))
      .slice(0, 8);
    if (!preserveIndex) {
      tagSuggestIndex = 0;
    } else {
      tagSuggestIndex = Math.min(tagSuggestIndex, Math.max(tagSuggestions.length - 1, 0));
    }
    if (tagSuggestions.length == 0) {
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
      return;
    }
    tagsSuggest.innerHTML = tagSuggestions
      .map((tag, index) => {
        const label = tag.name;
        return `
          <button class="app-shell__tags-suggest-item ${index == tagSuggestIndex ? "is-active" : ""}" data-tag-id="${tag.id}">
            ${label}
          </button>
        `;
      })
      .join("");
    tagsSuggest.style.display = "block";
  };

  const applyTagSuggestion = (tag?: Tag) => {
    const name = tag?.name ?? tagsInput.value.trim();
    if (!name) return;
    if (tag) {
      const state = appStore.getState();
      if (state.noteTags.some((entry) => entry.id === tag.id)) {
        return;
      }
    }
    actions.addTagToNote(name);
    tagsInput.value = "";
    tagSuggestions = [];
    tagsSuggest.style.display = "none";
    tagsSuggest.innerHTML = "";
  };

  const handleTagsKeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      if (tagSuggestions.length === 0) return;
      event.preventDefault();
      tagSuggestIndex = Math.min(tagSuggestIndex + 1, tagSuggestions.length - 1);
      updateTagSuggestions(true);
      return;
    }
    if (event.key === "ArrowUp") {
      if (tagSuggestions.length === 0) return;
      event.preventDefault();
      tagSuggestIndex = Math.max(tagSuggestIndex - 1, 0);
      updateTagSuggestions(true);
      return;
    }
    if (event.key === "Enter") {
      if (!tagsInput.value.trim()) return;
      event.preventDefault();
      if (tagSuggestions.length > 0) {
        applyTagSuggestion(tagSuggestions[tagSuggestIndex]);
      } else {
        applyTagSuggestion();
      }
      return;
    }
    if (event.key === "Tab") {
      if (!tagsInput.value.trim()) return;
      event.preventDefault();
      applyTagSuggestion();
      return;
    }
    if (event.key === "Escape") {
      tagSuggestions = [];
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
    }
  };

  tagsInput.addEventListener("input", updateTagSuggestions);
  tagsInput.addEventListener("keydown", handleTagsKeydown);
  tagsSuggest.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const item = target.closest<HTMLElement>("[data-tag-id]");
    if (!item) return;
    event.preventDefault();
    const id = Number(item.dataset.tagId);
    const tag = appStore.getState().tags.find((entry) => entry.id === id);
    if (tag) {
      applyTagSuggestion(tag);
    }
  });
  tagsList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const button = target.closest<HTMLButtonElement>(".app-shell__tag-remove");
    if (!button) return;
    event.preventDefault();
    const tagId = Number(button.dataset.tagId);
    if (Number.isNaN(tagId)) return;
    actions.removeTagFromNote(tagId);
  });

  const setEditorLoadingVisible = (visible: boolean) => {
    editorLoading.style.display = visible ? "flex" : "none";
  };

  const buildScopeLabel = (state: ReturnType<typeof appStore.getState>) => {
    if (state.selectedNotebookId !== null) {
      const notebook = state.notebooks.find((nb) => nb.id === state.selectedNotebookId);
      const stack = notebook?.parentId ? state.notebooks.find((nb) => nb.id === notebook.parentId) : null;
      if (stack) return `${stack.name} - ${notebook?.name ?? "Notebook"}`;
      return notebook?.name ?? "Notebook";
    }
    return "All Notes";
  };

  const tokenizeQuery = (value: string) =>
    value
      .replace(/["']/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

  const buildSearchQuery = (tokens: string[]) => {
    const cleaned = tokens
      .map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, ""))
      .filter((token) => token.length > 0);
    if (cleaned.length === 0) return "";
    return cleaned.map((token) => `${token}*`).join(" AND ");
  };

  const highlightHtml = (html: string, tokens: string[]) => {
    if (tokens.length === 0) return html;
    const container = document.createElement("div");
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const escaped = tokens
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    nodes.forEach((node) => {
      const value = node.nodeValue || "";
      if (!regex.test(value)) return;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      value.replace(regex, (match, _group, offset) => {
        if (offset > lastIndex) {
          frag.appendChild(document.createTextNode(value.slice(lastIndex, offset)));
        }
        const mark = document.createElement("span");
        mark.className = "search-modal__highlight";
        mark.textContent = match;
        frag.appendChild(mark);
        lastIndex = offset + match.length;
        return match;
      });
      if (lastIndex < value.length) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex)));
      }
      node.parentNode?.replaceChild(frag, node);
    });
    return container.innerHTML;
  };

  const buildPreviewHtml = (html: string, tokens: string[]) => {
    const maxHighlightLength = 120000;
    if (html.length > maxHighlightLength) {
      return html;
    }
    return highlightHtml(html, tokens);
  };

  const renderSearchResults = () => {
    if (!searchHasRun) {
      searchResults.innerHTML = "";
      searchEmpty.style.display = "none";
      return;
    }
    if (searchResultsData.length === 0) {
      searchResults.innerHTML = "";
      searchEmpty.style.display = "flex";
      searchPreviewEditor?.update("");
      return;
    }
    searchEmpty.style.display = "none";
    const state = appStore.getState();
    const map = new Map(state.notebooks.map((nb) => [nb.id, nb]));
    searchResults.innerHTML = searchResultsData
      .map((note) => {
        const notebook = note.notebookId ? map.get(note.notebookId) : null;
        const stack = notebook?.parentId ? map.get(notebook.parentId) : null;
        const parts = [stack?.name, notebook?.name, note.title || "Untitled"].filter(Boolean).join(" - ");
        return `
          <div class="search-modal__result ${note.id === searchSelectedNoteId ? "is-active" : ""}" data-note-id="${note.id}">
            <span class="search-modal__result-text">${escapeHtml(parts)}</span>
            <button class="search-modal__result-open" type="button" data-action="open-note" data-note-id="${note.id}">
              <svg class="search-modal__result-icon" aria-hidden="true">
                <use href="#icon-note"></use>
              </svg>
              Open
            </button>
          </div>
        `;
      })
      .join("");
  };

  const selectSearchResult = async (noteId: number | null) => {
    if (!noteId) {
      searchSelectedNoteId = null;
      searchPreviewEditor?.update("");
      renderSearchResults();
      return;
    }
    searchSelectedNoteId = noteId;
    renderSearchResults();
    try {
      const note = await getNote(noteId);
      if (!note) return;
      const normalized = ensureNotesScheme(normalizeEnmlContent(note.content));
      const displayContent = await toDisplayContent(normalized);
      const previewHtml = buildPreviewHtml(displayContent || "", searchTokens);
      if (!searchPreviewEditor) {
        searchPreviewEditor = mountPreviewEditor(searchPreviewBody);
      }
      searchPreviewEditor.update(previewHtml);
    } catch (e) {
      console.error("[search] preview failed", e);
    }
  };

  const openSearchResult = (noteId: number) => {
    const note = searchResultsData.find((item) => item.id === noteId);
    if (!note) return;
    const notebookId = note.notebookId ?? null;
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
    setSearchVisible(false);
  };

  const runSearch = async () => {
    const runToken = ++searchRunToken;
    const query = searchInput.value.trim();
    searchTokens = tokenizeQuery(query);
    if (searchTokens.length === 0) {
      searchResultsData = [];
      searchHasRun = false;
      setSearchLoading(false);
      setSearchResultsVisible(false);
      renderSearchResults();
      return;
    }
    setSearchLoading(true);
    setSearchResultsVisible(false);
    try {
      const scopeNotebookId = searchEverywhereActive ? null : searchScopeNotebookId;
      const searchQuery = buildSearchQuery(searchTokens);
      if (!searchQuery) {
        searchResultsData = [];
        searchSelectedNoteId = null;
        searchHasRun = true;
        renderSearchResults();
        return;
      }
      const results = await searchNotes(searchQuery, scopeNotebookId);
      if (runToken !== searchRunToken) return;
      searchResultsData = results.slice(0, 100);
      searchSelectedNoteId = searchResultsData[0]?.id ?? null;
      searchHasRun = true;
      renderSearchResults();
      if (searchSelectedNoteId) {
        await selectSearchResult(searchSelectedNoteId);
      } else {
        setSearchResultsVisible(false);
      }
    } catch (e) {
      if (runToken !== searchRunToken) return;
      console.error("[search] failed", e);
      searchResultsData = [];
      searchSelectedNoteId = null;
      searchHasRun = true;
      renderSearchResults();
      setSearchResultsVisible(false);
    } finally {
      if (runToken === searchRunToken) {
        setSearchLoading(false);
        if (searchResultsData.length > 0) {
          setSearchResultsVisible(true);
        }
      }
    }
  };

  const updateSearchScopeState = () => {
    searchScope.classList.toggle("is-disabled", searchEverywhereActive);
    searchScope.classList.toggle("is-active", !searchEverywhereActive);
  };

  const setSearchLoading = (visible: boolean) => {
    if (searchLoadingTimer !== null) {
      window.clearTimeout(searchLoadingTimer);
      searchLoadingTimer = null;
    }
    if (visible) {
      searchLoadingTimer = window.setTimeout(() => {
        searchLoading.style.display = "flex";
        searchLoadingTimer = null;
      }, 180);
      return;
    }
    searchLoading.style.display = "none";
  };

  const setSearchResultsVisible = (visible: boolean) => {
    searchResults.style.display = visible ? "block" : "none";
    searchPreview.style.display = visible ? "block" : "none";
  };

  const setSearchVisible = (visible: boolean) => {
    isSearchOpen = visible;
    searchOverlay.style.display = visible ? "flex" : "none";
    if (!visible) {
      searchRunToken += 1;
      setSearchLoading(false);
    }
    if (visible) {
      const state = appStore.getState();
      searchScopeNotebookId = state.selectedNotebookId;
      searchScopeLabel = buildScopeLabel(state);
      searchScope.textContent = searchScopeLabel;
      searchEverywhereActive = false;
      searchEverywhere.classList.remove("is-active");
      updateSearchScopeState();
      searchInput.value = "";
      searchResultsData = [];
      searchSelectedNoteId = null;
      searchTokens = [];
      searchHasRun = false;
      setSearchLoading(false);
      setSearchResultsVisible(false);
      searchEmpty.style.display = "none";
      searchPreviewEditor?.update("");
      renderSearchResults();
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

  searchClose.addEventListener("click", () => {
    setSearchVisible(false);
  });

  searchSubmit.addEventListener("click", () => {
    runSearch();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearch();
    }
  });

  searchResults.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-action=\"open-note\"]")) {
      const button = target.closest<HTMLElement>("[data-action=\"open-note\"]");
      if (!button) return;
      const id = Number(button.dataset.noteId);
      if (!Number.isFinite(id)) return;
      openSearchResult(id);
      return;
    }
    const row = target.closest<HTMLElement>("[data-note-id]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (!Number.isFinite(id)) return;
    selectSearchResult(id);
  });

  searchResults.addEventListener("dblclick", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-note-id]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (!Number.isFinite(id)) return;
    openSearchResult(id);
  });

  searchEverywhere.addEventListener("click", () => {
    searchEverywhereActive = !searchEverywhereActive;
    searchEverywhere.classList.toggle("is-active", searchEverywhereActive);
    updateSearchScopeState();
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

    if (hasNote) {
      const map = new Map(state.tags.map((tag) => [tag.id, tag]));
      tagsList.innerHTML = state.noteTags
        .map((tag) => {
          const label = buildTagPath(tag, map);
          return `
            <span class="app-shell__tag">
              <span class="app-shell__tag-text">${label}</span>
              <button type="button" class="app-shell__tag-remove" data-tag-id="${tag.id}" aria-label="Remove tag">&times;</button>
            </span>
          `;
        })
        .join("");
    } else {
      tagsList.innerHTML = "";
      tagsInput.value = "";
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
    }

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
