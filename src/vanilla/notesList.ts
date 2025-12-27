export interface NotesListItem {
  id: number;
  title: string;
  content: string;
  excerpt?: string;
  updatedAt: number;
  notebookId: number | null;
}

export interface NotesListNotebook {
  id: number;
  name: string;
}

export type NotesListView = "detailed" | "compact";

export interface NotesListState {
  notes: NotesListItem[];
  notebooks: NotesListNotebook[];
  selectedNotebookId: number | null;
  selectedNoteId: number | null;
  notesListView: NotesListView;
  searchTerm: string;
  notesSortBy: "updated" | "title";
  notesSortDir: "asc" | "desc";
}

export interface NotesListHandlers {
  onSelectNote: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onSelectSort: (sortBy: "updated" | "title", sortDir: "asc" | "desc") => void;
  onToggleView: () => void;
  onFilterClick: () => void;
  onNoteContextMenu: (event: MouseEvent, id: number) => void;
  onMoveNote: (noteId: number, notebookId: number | null) => void;
}

export interface NotesListInstance {
  update: (state: NotesListState) => void;
  destroy: () => void;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");

const formatDate = (timestamp: number) => {
  if (!timestamp) return "";
  try {
    return new Date(timestamp * 1000).toLocaleDateString();
  } catch {
    return "";
  }
};

const renderNotesIcon = () => `
  <svg class="notes-list__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
  </svg>
`;

const renderFilterIcon = () => `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="22 3 2 3 10 12 10 19 14 21 14 12 22 3"></polygon>
  </svg>
`;

const renderSortIcon = () => `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 5h10"></path>
    <path d="M11 9h7"></path>
    <path d="M11 13h4"></path>
    <path d="M3 17V3"></path>
    <path d="M7 13l-4 4-4-4"></path>
  </svg>
`;

const renderViewIcon = () => `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="6" rx="2"></rect>
    <rect x="3" y="14" width="18" height="6" rx="2"></rect>
  </svg>
`;

const renderHeader = (state: NotesListState) => {
  const title = state.selectedNotebookId
    ? state.notebooks.find((n) => n.id === state.selectedNotebookId)?.name || "Notebooks"
    : "All Notes";
  const count = state.notes.length;
  const countLabel = `${count} ${count === 1 ? "Note" : "Notes"}`;
  const sortLabel =
    state.notesSortBy === "title"
      ? state.notesSortDir === "asc" ? "Name A-Z" : "Name Z-A"
      : state.notesSortDir === "asc" ? "Oldest first" : "Newest first";
  const viewLabel = state.notesListView === "compact" ? "Compact view" : "Detailed view";
  return `
    <div class="notes-list__header">
      <div class="notes-list__header-top">
        <div class="notes-list__heading">
          ${renderNotesIcon()}
          <h2 class="notes-list__title">${escapeHtml(title === "All Notes" ? "Notes" : title)}</h2>
        </div>
      </div>
      <div class="notes-list__header-bottom">
        <div class="notes-list__count">${countLabel}</div>
        <div class="notes-list__actions">
          <button class="notes-list__action" data-action="filter" title="Filter (coming soon)">
            ${renderFilterIcon()}
          </button>
          <button class="notes-list__action" data-action="sort" title="${sortLabel}">
            ${renderSortIcon()}
          </button>
          <button class="notes-list__action" data-action="view" title="${viewLabel}">
            ${renderViewIcon()}
          </button>
        </div>
      </div>
    </div>
  `;
};

const renderNoteRow = (note: NotesListItem, state: NotesListState) => {
  const isSelected = state.selectedNoteId === note.id;
  if (state.notesListView === "compact") {
    return `
      <div class="notes-list__row notes-list__row--compact ${isSelected ? "is-selected" : ""}" data-note-row="1" data-note-id="${note.id}">
        <div class="notes-list__row-line">
          <h3 class="notes-list__row-title">
            ${escapeHtml(note.title || "Untitled")}
          </h3>
          <div class="notes-list__row-date">
            ${formatDate(note.updatedAt)}
          </div>
        </div>
      </div>
    `;
  }

  const excerpt = note.excerpt ?? stripTags(note.content || "");
  return `
    <div class="notes-list__row ${isSelected ? "is-selected" : ""}" data-note-row="1" data-note-id="${note.id}">
      <div class="notes-list__row-top">
        <h3 class="notes-list__row-title notes-list__row-title--strong">
          ${escapeHtml(note.title || "Untitled")}
        </h3>
      </div>
      <p class="notes-list__excerpt">
        ${escapeHtml(excerpt || "No text")}
      </p>
      <div class="notes-list__row-date">
        ${formatDate(note.updatedAt)}
      </div>
    </div>
  `;
};

const renderList = (state: NotesListState) => {
  return `
    <div class="notes-list__items custom-scrollbar" data-notes-scroll="1">
      ${state.notes.map((note) => renderNoteRow(note, state)).join("")}
    </div>
  `;
};

const renderNotesList = (state: NotesListState) => `
  <div class="notes-list">
    ${renderHeader(state)}
    ${renderList(state)}
  </div>
`;

export const mountNotesList = (root: HTMLElement, handlers: NotesListHandlers): NotesListInstance => {
  let currentState: NotesListState | null = null;
  let lastRendered: NotesListState | null = null;
  let dragActive = false;
  let dragStarted = false;
  let ignoreClick = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragNoteId = 0;
  let dragOverlay: HTMLDivElement | null = null;
  let dragOverEl: HTMLElement | null = null;
  let dragOverNotebookId: number | null = null;
  let dragHasTarget = false;
  let sortMenu: HTMLDivElement | null = null;
  let sortMenuClickBound = false;

  const closeSortMenu = () => {
    if (!sortMenu) return;
    if (sortMenuClickBound) {
      sortMenu.removeEventListener("click", handleSortMenuClick);
      sortMenuClickBound = false;
    }
    sortMenu.remove();
    sortMenu = null;
  };

  const buildSortMenu = (state: NotesListState) => {
    const menu = document.createElement("div");
    menu.className = "notes-list__sort-menu";
    menu.innerHTML = `
      <button class="notes-list__sort-item" data-sort="updated_desc">
        <span>Newest first</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "updated" && state.notesSortDir === "desc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="updated_asc">
        <span>Oldest first</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "updated" && state.notesSortDir === "asc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="title_asc">
        <span>Name A-Z</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "title" && state.notesSortDir === "asc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="title_desc">
        <span>Name Z-A</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "title" && state.notesSortDir === "desc" ? "✓" : ""}</span>
      </button>
    `;
    return menu;
  };

  const openSortMenu = (anchor: HTMLElement, state: NotesListState) => {
    closeSortMenu();
    sortMenu = buildSortMenu(state);
    sortMenu.addEventListener("click", handleSortMenuClick);
    sortMenuClickBound = true;
    document.body.appendChild(sortMenu);
    const rect = anchor.getBoundingClientRect();
    const menuWidth = sortMenu.offsetWidth;
    sortMenu.style.top = `${rect.bottom + 6}px`;
    sortMenu.style.left = `${rect.right - menuWidth}px`;
  };

  const handleSortMenuClick = (event: MouseEvent) => {
    if (!sortMenu) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const item = target.closest<HTMLElement>("[data-sort]");
    if (!item) return;
    const sort = item.dataset.sort;
    if (sort === "updated_desc") handlers.onSelectSort("updated", "desc");
    if (sort === "updated_asc") handlers.onSelectSort("updated", "asc");
    if (sort === "title_asc") handlers.onSelectSort("title", "asc");
    if (sort === "title_desc") handlers.onSelectSort("title", "desc");
    closeSortMenu();
  };

  const handleWindowClick = (event: MouseEvent) => {
    if (!sortMenu) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest<HTMLElement>("[data-action=\"sort\"]")) {
      return;
    }
    if (sortMenu.contains(target)) return;
    closeSortMenu();
  };

  const cleanupDrag = () => {
    dragActive = false;
    dragStarted = false;
    ignoreClick = false;
    dragNoteId = 0;
    dragOverNotebookId = null;
    dragHasTarget = false;
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
    if (dragOverEl) {
      dragOverEl.classList.remove("notes-list__drop-target");
      dragOverEl = null;
    }
    document.body.style.cursor = "";
  };

  const getNote = (id: number) => currentState?.notes.find((note) => note.id === id) ?? null;

  const updateOverlay = (clientX: number, clientY: number) => {
    if (!dragOverlay) return;
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
  };

  const startDrag = (noteTitle: string, clientX: number, clientY: number) => {
    dragStarted = true;
    ignoreClick = true;
    dragOverlay = document.createElement("div");
    dragOverlay.className = "notes-list__drag-overlay";
    dragOverlay.style.left = "0";
    dragOverlay.style.top = "0";
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
    dragOverlay.innerHTML = `
      <div class="notes-list__drag-card">
        ${escapeHtml(noteTitle || "Untitled")}
      </div>
    `;
    document.body.appendChild(dragOverlay);
    document.body.style.cursor = "grabbing";
  };

  const resolveDropTarget = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    const allNotes = el.closest<HTMLElement>("[data-drop-all]");
    if (allNotes) {
      return { el: allNotes, notebookId: null };
    }
    const row = el.closest<HTMLElement>("[data-notebook-row]");
    if (!row) return null;
    const type = row.dataset.notebookType;
    if (type !== "notebook") return null;
    const id = Number(row.dataset.notebookId);
    if (!Number.isFinite(id)) return null;
    return { el: row, notebookId: id };
  };

  const updateDropHighlight = (target: { el: HTMLElement; notebookId: number | null } | null) => {
    if (dragOverEl && dragOverEl !== target?.el) {
      dragOverEl.classList.remove("notes-list__drop-target");
      dragOverEl = null;
    }
    if (!target) {
      dragOverNotebookId = null;
      dragHasTarget = false;
      return;
    }
    dragOverEl = target.el;
    dragOverNotebookId = target.notebookId;
    dragHasTarget = true;
    dragOverEl.classList.add("notes-list__drop-target");
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button")) return;
    const row = target.closest<HTMLElement>("[data-note-row]");
    if (!row || !root.contains(row)) return;
    const id = Number(row.dataset.noteId);
    if (!Number.isFinite(id)) return;
    dragActive = true;
    dragStarted = false;
    document.body.classList.add("is-dragging");
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragNoteId = id;
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragActive) return;
    event.preventDefault();
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!dragStarted) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      const note = getNote(dragNoteId);
      if (!note) {
        cleanupDrag();
        return;
      }
      startDrag(note.title, event.clientX, event.clientY);
    }
    updateOverlay(event.clientX, event.clientY);
    const target = resolveDropTarget(event.clientX, event.clientY);
    updateDropHighlight(target);
    event.preventDefault();
  };

  const handlePointerUp = () => {
    if (!dragActive) return;
    if (!dragStarted && dragNoteId) {
      ignoreClick = true;
      handlers.onSelectNote(dragNoteId);
      cleanupDrag();
      return;
    }
    if (dragStarted && dragNoteId && dragHasTarget) {
      handlers.onMoveNote(dragNoteId, dragOverNotebookId);
    }
    cleanupDrag();
  };

  const handlePointerCancel = () => {
    if (!dragActive) return;
    cleanupDrag();
  };

  const handleClick = (event: MouseEvent) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const headerAction = target.closest<HTMLElement>("[data-action]");
    if (headerAction?.dataset.action === "delete-note") {
      event.stopPropagation();
      const id = Number(headerAction.dataset.noteId);
      if (Number.isFinite(id)) handlers.onDeleteNote(id);
      return;
    }
    if (headerAction && headerAction.dataset.action) {
      const action = headerAction.dataset.action;
      if (action === "filter") {
        handlers.onFilterClick();
        return;
      }
      if (action === "sort") {
        event.stopPropagation();
        if (currentState) {
          openSortMenu(headerAction, currentState);
        }
        return;
      }
      if (action === "view") {
        event.stopPropagation();
        handlers.onToggleView();
        return;
      }
    }
    const row = target.closest<HTMLElement>("[data-note-row]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (Number.isFinite(id)) handlers.onSelectNote(id);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Delete") return;
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
    }
    const selectedId = currentState?.selectedNoteId ?? null;
    if (!selectedId) return;
    event.preventDefault();
    handlers.onDeleteNote(selectedId);
  };

  const handleContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-note-row]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (!Number.isFinite(id)) return;
    handlers.onNoteContextMenu(event, id);
  };

  root.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);
  root.addEventListener("click", handleClick);
  root.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("click", handleWindowClick);

  const updateSelection = (prevId: number | null, nextId: number | null, view: NotesListView) => {
    if (prevId !== null) {
      const prevRow = root.querySelector<HTMLElement>(`[data-note-row="1"][data-note-id="${prevId}"]`);
      if (prevRow) {
        prevRow.classList.remove("is-selected");
      }
    }
    if (nextId !== null) {
      const nextRow = root.querySelector<HTMLElement>(`[data-note-row="1"][data-note-id="${nextId}"]`);
      if (nextRow) {
        nextRow.classList.add("is-selected");
      }
    }
  };

  return {
    update: (state: NotesListState) => {
      const prev = lastRendered;
      const shouldFullRender =
        !prev ||
        prev.notes !== state.notes ||
        prev.notebooks !== state.notebooks ||
        prev.selectedNotebookId !== state.selectedNotebookId ||
        prev.notesListView !== state.notesListView ||
        prev.searchTerm !== state.searchTerm;

      currentState = state;
      cleanupDrag();

      if (shouldFullRender) {
        root.innerHTML = renderNotesList(state);
      } else if (prev.selectedNoteId !== state.selectedNoteId) {
        updateSelection(prev.selectedNoteId, state.selectedNoteId, state.notesListView);
      }

      lastRendered = state;
    },
    destroy: () => {
      root.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      root.removeEventListener("click", handleClick);
      root.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleWindowClick);
      cleanupDrag();
      closeSortMenu();
      root.innerHTML = "";
    },
  };
};
