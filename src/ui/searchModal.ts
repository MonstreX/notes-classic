import { normalizeFileLinks, normalizeEnmlContent, toDisplayContent } from "../services/content";
import { getNote, searchNotes } from "../services/notes";
import { getOcrStats } from "../services/ocr";
import { appStore } from "../state/store";
import type { NoteListItem } from "../state/types";
import { mountPreviewEditor, type EditorInstance } from "./editor";
import { createIcon } from "./icons";
import { t } from "../services/i18n";

type SearchModalHandlers = {
  onOpenNote: (noteId: number, notebookId: number | null) => void;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const mountSearchModal = (container: HTMLElement, handlers: SearchModalHandlers) => {
  const searchOverlay = document.createElement("div");
  searchOverlay.className = "search-modal";
  searchOverlay.style.display = "none";
  const searchPanel = document.createElement("div");
  searchPanel.className = "search-modal__panel";
  const searchHeader = document.createElement("div");
  searchHeader.className = "search-modal__header";
  const searchTitle = document.createElement("div");
  searchTitle.className = "search-modal__title";
  searchTitle.textContent = t("search.title");
  const searchClose = document.createElement("button");
  searchClose.className = "search-modal__close";
  searchClose.type = "button";
  searchClose.setAttribute("aria-label", t("settings.close"));
  const searchCloseIcon = createIcon("icon-close", "search-modal__close-icon");
  searchClose.appendChild(searchCloseIcon);
  searchHeader.appendChild(searchTitle);
  searchHeader.appendChild(searchClose);
  const searchField = document.createElement("div");
  searchField.className = "search-modal__field";
  const searchInput = document.createElement("input");
  searchInput.className = "search-modal__input";
  searchInput.type = "text";
  searchInput.placeholder = t("search.placeholder");
  const searchFieldIcon = createIcon("icon-search", "search-modal__icon");
  const searchSubmit = document.createElement("button");
  searchSubmit.className = "search-modal__button";
  searchSubmit.type = "button";
  searchSubmit.textContent = t("search.title");
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
  searchLoadingText.textContent = t("search.searching");
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
  searchEverywhereText.textContent = t("search.everywhere");
  searchEverywhere.appendChild(searchEverywhereText);
  const searchScope = document.createElement("button");
  searchScope.type = "button";
  searchScope.className = "search-modal__toggle search-modal__scope";
  const searchOptionsSpacer = document.createElement("div");
  searchOptionsSpacer.className = "search-modal__options-spacer";
  const searchOcrStatus = document.createElement("div");
  searchOcrStatus.className = "search-modal__ocr-status";
  const searchOcrSpinner = document.createElement("span");
  searchOcrSpinner.className = "search-modal__ocr-spinner";
  const searchOcrText = document.createElement("span");
  searchOcrText.className = "search-modal__ocr-text";
  searchOcrText.textContent = t("search.index.none");
  searchOcrStatus.appendChild(searchOcrSpinner);
  searchOcrStatus.appendChild(searchOcrText);
  searchOptions.appendChild(searchEverywhere);
  searchOptions.appendChild(searchScope);
  searchOptions.appendChild(searchOptionsSpacer);
  searchOptions.appendChild(searchOcrStatus);
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
  searchEmptyText.textContent = t("search.no_results");
  searchEmpty.appendChild(searchEmptyIcon);
  searchEmpty.appendChild(searchEmptyText);
  searchPanel.appendChild(searchEmpty);
  searchOverlay.appendChild(searchPanel);
  container.appendChild(searchOverlay);

  let isSearchOpen = false;
  let searchEverywhereActive = false;
  let searchScopeNotebookId: number | null = null;
  let searchScopeLabel = t("sidebar.all_notes");
  let searchResultsData: NoteListItem[] = [];
  let searchSelectedNoteId: number | null = null;
  let searchTokens: string[] = [];
  let searchHasRun = false;
  let searchLoadingTimer: number | null = null;
  let searchRunToken = 0;
  let searchPreviewEditor: EditorInstance | null = null;
  let searchOcrTimer: number | null = null;

  const buildScopeLabel = (state: ReturnType<typeof appStore.getState>) => {
    if (state.selectedNotebookId !== null) {
      const notebook = state.notebooks.find((nb) => nb.id === state.selectedNotebookId);
      const stack = notebook?.parentId ? state.notebooks.find((nb) => nb.id === notebook.parentId) : null;
      if (stack) return `${stack.name} - ${notebook?.name ?? t("notes.notebook_default")}`;
      return notebook?.name ?? t("notes.notebook_default");
    }
    return t("sidebar.all_notes");
  };

  const tokenizeQuery = (value: string) => {
    const rawTokens = value
      .replace(/["']/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const tokens: string[] = [];
    for (const token of rawTokens) {
      if (token.includes("-") && /\d/.test(token)) {
        token
          .split("-")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .forEach((part) => tokens.push(part));
      } else {
        tokens.push(token);
      }
    }
    return tokens;
  };

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
        const scope = [stack?.name, notebook?.name].filter(Boolean).join(" - ");
        const title = note.title || t("notes.untitled");
        const ocrIcon = note.ocrMatch
          ? `<svg class="search-modal__result-ocr-icon" aria-hidden="true"><use href="#icon-image"></use></svg>`
          : "";
        return `
          <div class="search-modal__result ${note.id === searchSelectedNoteId ? "is-active" : ""}" data-note-id="${note.id}">
            <div class="search-modal__result-main">
              <span class="search-modal__result-title">${escapeHtml(title)}</span>
              <span class="search-modal__result-meta">${escapeHtml(scope)}</span>
            </div>
            ${ocrIcon}
            <button class="search-modal__result-open" type="button" data-action="open-note" data-note-id="${note.id}">
              <svg class="search-modal__result-icon" aria-hidden="true">
                <use href="#icon-note"></use>
              </svg>
              ${t("search.open")}
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
      const normalized = normalizeFileLinks(normalizeEnmlContent(note.content));
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
    handlers.onOpenNote(noteId, note.notebookId ?? null);
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
    searchEverywhere.classList.toggle("is-active", searchEverywhereActive);
    searchScope.classList.toggle("is-active", !searchEverywhereActive);
  };

  const updateOcrStatus = async () => {
    try {
      const stats = await getOcrStats();
        if (stats.total === 0) {
          searchOcrText.textContent = t("search.index.none");
          searchOcrStatus.classList.remove("is-active");
        } else {
          searchOcrText.textContent = t("search.index.progress", { done: stats.done, total: stats.total });
          searchOcrStatus.classList.toggle("is-active", stats.pending > 0);
        }
      } catch (e) {
      console.error("[ocr] stats failed", e);
      searchOcrText.textContent = t("search.index.unavailable");
      searchOcrStatus.classList.remove("is-active");
    }
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
      if (searchOcrTimer !== null) {
        window.clearInterval(searchOcrTimer);
        searchOcrTimer = null;
      }
      return;
    }
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
    updateOcrStatus();
    if (searchOcrTimer !== null) {
      window.clearInterval(searchOcrTimer);
    }
    searchOcrTimer = window.setInterval(updateOcrStatus, 2000);
    window.setTimeout(() => {
      searchInput.focus();
      searchInput.select();
    }, 0);
  };

  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isSearchOpen) {
      setSearchVisible(false);
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === searchOverlay) {
      setSearchVisible(false);
    }
  };
  const handleCloseClick = () => {
    setSearchVisible(false);
  };
  const handleSubmitClick = () => {
    runSearch();
  };
  const handleInputKeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      runSearch();
    }
  };
  const handleResultsClick = (event: MouseEvent) => {
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
    if (event.detail >= 2) {
      openSearchResult(id);
      return;
    }
    selectSearchResult(id);
  };
  const handleResultsDblClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const result = target.closest<HTMLElement>(".search-modal__result");
    if (!result) return;
    if (target.closest("[data-action=\"open-note\"]")) {
      const button = target.closest<HTMLElement>("[data-action=\"open-note\"]");
      if (!button) return;
      const id = Number(button.dataset.noteId);
      if (!Number.isFinite(id)) return;
      openSearchResult(id);
      return;
    }
    const id = Number(result.dataset.noteId);
    if (!Number.isFinite(id)) return;
    openSearchResult(id);
  };
  const handleEverywhereClick = () => {
    searchEverywhereActive = true;
    updateSearchScopeState();
  };
  const handleScopeClick = () => {
    searchEverywhereActive = false;
    updateSearchScopeState();
  };

  searchOverlay.addEventListener("click", handleOverlayClick);
  searchClose.addEventListener("click", handleCloseClick);
  searchSubmit.addEventListener("click", handleSubmitClick);
  searchInput.addEventListener("keydown", handleInputKeydown);
  searchResults.addEventListener("click", handleResultsClick);
  searchResults.addEventListener("dblclick", handleResultsDblClick);
  searchEverywhere.addEventListener("click", handleEverywhereClick);
  searchScope.addEventListener("click", handleScopeClick);
  window.addEventListener("keydown", handleSearchKeydown);

  return {
    open: () => setSearchVisible(true),
    close: () => setSearchVisible(false),
    destroy: () => {
      if (searchOcrTimer !== null) {
        window.clearInterval(searchOcrTimer);
      }
      if (searchLoadingTimer !== null) {
        window.clearTimeout(searchLoadingTimer);
      }
      searchOverlay.removeEventListener("click", handleOverlayClick);
      searchClose.removeEventListener("click", handleCloseClick);
      searchSubmit.removeEventListener("click", handleSubmitClick);
      searchInput.removeEventListener("keydown", handleInputKeydown);
      searchResults.removeEventListener("click", handleResultsClick);
      searchResults.removeEventListener("dblclick", handleResultsDblClick);
        searchEverywhere.removeEventListener("click", handleEverywhereClick);
        searchScope.removeEventListener("click", handleScopeClick);
      window.removeEventListener("keydown", handleSearchKeydown);
      searchPreviewEditor?.destroy();
      searchOverlay.remove();
    },
  };
};
