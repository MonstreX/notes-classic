import type { Tag } from "../state/types";
import { DRAG_START_PX, hasDragDistance } from "./dragConfig";
import { t, tCount } from "../services/i18n";

export interface NotesListItem {
  id: number;
  title: string;
  content: string;
  excerpt?: string;
  updatedAt: number;
  notebookId: number | null;
  ocrMatch?: boolean;
}

export interface NotesListNotebook {
  id: number;
  name: string;
}

export type NotesListView = "detailed" | "compact";

export interface NotesListState {
  notes: NotesListItem[];
  notebooks: NotesListNotebook[];
  tags: Tag[];
  selectedNotebookId: number | null;
  selectedTagId: number | null;
  selectedTrash: boolean;
  selectedNoteId: number | null;
  selectedNoteIds: Set<number>;
  notesListView: NotesListView;
  notesSortBy: "updated" | "title";
  notesSortDir: "asc" | "desc";
}

export interface NotesListHandlers {
  onSelectNote: (id: number) => void;
  onSelectNotes: (ids: number[], primaryId: number) => void;
  onDeleteNote: (id: number) => void;
  onRenameNote: (id: number) => void;
  onSelectSort: (sortBy: "updated" | "title", sortDir: "asc" | "desc") => void;
  onToggleView: () => void;
  onFilterClick: () => void;
  onNoteContextMenu: (event: MouseEvent, id: number) => void;
  onMoveNotes: (noteIds: number[], notebookId: number | null) => void;
  onDropToTrash: (noteIds: number[]) => void;
  onDropToTag: (noteIds: number[], tagId: number) => void;
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
  <svg class="notes-list__icon" width="18" height="18" aria-hidden="true">
    <use href="#icon-note"></use>
  </svg>
`;

const renderFilterIcon = () => `
  <svg class="notes-list__action-icon" width="16" height="16" aria-hidden="true">
    <use href="#icon-filter"></use>
  </svg>
`;

const renderSortIcon = () => `
  <svg class="notes-list__action-icon" width="16" height="16" aria-hidden="true">
    <use href="#icon-sort"></use>
  </svg>
`;

const renderViewIcon = () => `
  <svg class="notes-list__action-icon" width="16" height="16" aria-hidden="true">
    <use href="#icon-view"></use>
  </svg>
`;

const getHeaderTitle = (state: NotesListState) => {
  if (state.selectedTrash) return t("sidebar.trash");
  const tagTitle = state.selectedTagId
    ? state.tags.find((tag) => tag.id === state.selectedTagId)?.name || t("notes.tag_default")
    : null;
  const title = tagTitle
    ? tagTitle
    : state.selectedNotebookId
      ? state.notebooks.find((n) => n.id === state.selectedNotebookId)?.name || t("sidebar.notebooks")
      : t("sidebar.all_notes");
  return title === t("sidebar.all_notes") ? t("notes.title") : title;
};

const getCountLabel = (state: NotesListState) => {
  const count = state.notes.length;
  return tCount("notes.count", count);
};

const getSortLabel = (state: NotesListState) => {
  return state.notesSortBy === "title"
    ? state.notesSortDir === "asc" ? t("notes.sort.name_asc") : t("notes.sort.name_desc")
    : state.notesSortDir === "asc" ? t("notes.sort.oldest") : t("notes.sort.newest");
};

const getViewLabel = (state: NotesListState) =>
  state.notesListView === "compact" ? t("notes.view.compact") : t("notes.view.detailed");

const renderHeader = (state: NotesListState) => {
  const countLabel = getCountLabel(state);
  const sortLabel =
    state.notesSortBy === "title"
      ? state.notesSortDir === "asc" ? "Name A-Z" : "Name Z-A"
      : state.notesSortDir === "asc" ? "Oldest first" : "Newest first";
  const viewLabel = getViewLabel(state);
  return `
    <div class="notes-list__header">
      <div class="notes-list__header-top">
        <div class="notes-list__heading">
          ${renderNotesIcon()}
          <h2 class="notes-list__title">${escapeHtml(getHeaderTitle(state))}</h2>
        </div>
      </div>
      <div class="notes-list__header-bottom">
        <div class="notes-list__count">${countLabel}</div>
        <div class="notes-list__actions">
          <button class="notes-list__action" data-action="filter" title="${t("notes.filter.coming")}">
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
  const isSelected = state.selectedNoteIds.has(note.id);
  if (state.notesListView === "compact") {
    return `
      <div class="notes-list__row notes-list__row--compact ${isSelected ? "is-selected" : ""}" data-note-row="1" data-note-id="${note.id}">
        <div class="notes-list__row-line">
          <h3 class="notes-list__row-title">
            ${escapeHtml(note.title || t("notes.untitled"))}
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
          ${escapeHtml(note.title || t("notes.untitled"))}
        </h3>
      </div>
      <p class="notes-list__excerpt">
        ${escapeHtml(excerpt || t("notes.no_text"))}
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
  let headerTitleEl: HTMLElement | null = null;
  let headerCountEl: HTMLElement | null = null;
  let sortButtonEl: HTMLElement | null = null;
  let viewButtonEl: HTMLElement | null = null;
  let anchorNoteId: number | null = null;
  let dragActive = false;
  let dragStarted = false;
  let ignoreClick = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragNoteId = 0;
  let dragOverlay: HTMLDivElement | null = null;
  let dragOverEl: HTMLElement | null = null;
  let dragOverNotebookId: number | null = null;
  let dragOverTagId: number | null = null;
  let dragOverTrash = false;
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
        <span>${t("notes.sort.newest")}</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "updated" && state.notesSortDir === "desc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="updated_asc">
        <span>${t("notes.sort.oldest")}</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "updated" && state.notesSortDir === "asc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="title_asc">
        <span>${t("notes.sort.name_asc")}</span>
        <span class="notes-list__sort-check">${state.notesSortBy === "title" && state.notesSortDir === "asc" ? "✓" : ""}</span>
      </button>
      <button class="notes-list__sort-item" data-sort="title_desc">
        <span>${t("notes.sort.name_desc")}</span>
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
      dragOverEl.classList.remove("is-drag-over");
      dragOverEl = null;
    }
    document.body.style.cursor = "";
  };

  const getNote = (id: number) => currentState?.notes.find((note) => note.id === id) ?? null;

  const updateOverlay = (clientX: number, clientY: number) => {
    if (!dragOverlay) return;
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
  };

  const startDrag = (label: string, clientX: number, clientY: number) => {
    dragStarted = true;
    ignoreClick = true;
    dragOverlay = document.createElement("div");
    dragOverlay.className = "notes-list__drag-overlay";
    dragOverlay.style.left = "0";
    dragOverlay.style.top = "0";
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
    dragOverlay.innerHTML = `
      <div class="notes-list__drag-card">
        ${escapeHtml(label || t("notes.untitled"))}
      </div>
    `;
    document.body.appendChild(dragOverlay);
    document.body.style.cursor = "grabbing";
  };

  const resolveDropTarget = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    const trashRow = el.closest<HTMLElement>("[data-trash-row]");
    if (trashRow) {
      return { kind: "trash" as const, el: trashRow };
    }
    const tagRow = el.closest<HTMLElement>("[data-tag-row]");
    if (tagRow) {
      const id = Number(tagRow.dataset.tagId);
      if (!Number.isFinite(id)) return null;
      return { kind: "tag" as const, el: tagRow, tagId: id };
    }
    const allNotes = el.closest<HTMLElement>("[data-drop-all]");
    if (allNotes) {
      return { kind: "all" as const, el: allNotes, notebookId: null };
    }
    const row = el.closest<HTMLElement>("[data-notebook-row]");
    if (!row) return null;
    const type = row.dataset.notebookType;
    if (type !== "notebook") return null;
    const id = Number(row.dataset.notebookId);
    if (!Number.isFinite(id)) return null;
    return { kind: "notebook" as const, el: row, notebookId: id };
  };

  const updateDropHighlight = (
    target:
      | { kind: "notebook" | "all"; el: HTMLElement; notebookId: number | null }
      | { kind: "tag"; el: HTMLElement; tagId: number }
      | { kind: "trash"; el: HTMLElement }
      | null
  ) => {
    if (dragOverEl && dragOverEl !== target?.el) {
      dragOverEl.classList.remove("is-drag-over");
      dragOverEl = null;
    }
    if (!target) {
      dragOverNotebookId = null;
      dragOverTagId = null;
      dragOverTrash = false;
      dragHasTarget = false;
      return;
    }
    dragOverEl = target.el;
    dragOverNotebookId = target.kind === "notebook" || target.kind === "all" ? target.notebookId : null;
    dragOverTagId = target.kind === "tag" ? target.tagId : null;
    dragOverTrash = target.kind === "trash";
    dragHasTarget = true;
    dragOverEl.classList.add("is-drag-over");
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (currentState?.selectedTrash) return;
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
      if (!hasDragDistance(dx, dy, DRAG_START_PX)) return;
      const note = getNote(dragNoteId);
      if (!note) {
        cleanupDrag();
        return;
      }
      const selectedIds = currentState?.selectedNoteIds ?? new Set<number>();
      const isGrouped = selectedIds.has(dragNoteId) && selectedIds.size > 1;
      const label = isGrouped ? tCount("notes.count", selectedIds.size) : note.title;
      startDrag(label, event.clientX, event.clientY);
    }
    updateOverlay(event.clientX, event.clientY);
    const target = resolveDropTarget(event.clientX, event.clientY);
    updateDropHighlight(target);
    event.preventDefault();
  };

  const handlePointerUp = () => {
    if (!dragActive) return;
    if (dragStarted && dragNoteId && dragHasTarget) {
      const selectedIds = currentState?.selectedNoteIds ?? new Set<number>();
      const ids = selectedIds.has(dragNoteId) ? Array.from(selectedIds) : [dragNoteId];
      if (dragOverTrash) {
        handlers.onDropToTrash(ids);
      } else if (dragOverTagId !== null) {
        handlers.onDropToTag(ids, dragOverTagId);
      } else {
        handlers.onMoveNotes(ids, dragOverNotebookId);
      }
    }
    if (dragStarted) {
      ignoreClick = true;
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
    if (!Number.isFinite(id) || !currentState) return;

    const isCtrl = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;
    const currentIds = new Set(currentState.selectedNoteIds);

    if (isShift) {
      const notes = currentState.notes;
      const anchorId = anchorNoteId ?? currentState.selectedNoteId ?? id;
      const anchorIndex = notes.findIndex((note) => note.id === anchorId);
      const targetIndex = notes.findIndex((note) => note.id === id);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] = anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        const rangeIds = notes.slice(start, end + 1).map((note) => note.id);
        const nextIds = isCtrl ? new Set([...currentIds, ...rangeIds]) : new Set(rangeIds);
        handlers.onSelectNotes(Array.from(nextIds), id);
      } else {
        handlers.onSelectNotes([id], id);
      }
    } else if (isCtrl) {
      if (currentIds.has(id)) {
        currentIds.delete(id);
      } else {
        currentIds.add(id);
      }
      if (currentIds.size === 0) {
        currentIds.add(id);
      }
      handlers.onSelectNotes(Array.from(currentIds), id);
    } else {
      handlers.onSelectNotes([id], id);
    }
    anchorNoteId = id;
  };

  const cacheHeaderRefs = () => {
    headerTitleEl = root.querySelector<HTMLElement>(".notes-list__title");
    headerCountEl = root.querySelector<HTMLElement>(".notes-list__count");
    sortButtonEl = root.querySelector<HTMLElement>("[data-action=\"sort\"]");
    viewButtonEl = root.querySelector<HTMLElement>("[data-action=\"view\"]");
  };

  const updateHeader = (state: NotesListState) => {
    if (!headerTitleEl || !headerCountEl) {
      cacheHeaderRefs();
    }
    if (!headerTitleEl || !headerCountEl) return;
    headerTitleEl.textContent = getHeaderTitle(state);
    headerCountEl.textContent = getCountLabel(state);
    if (sortButtonEl) {
      sortButtonEl.setAttribute("title", getSortLabel(state));
    }
    if (viewButtonEl) {
      viewButtonEl.setAttribute("title", getViewLabel(state));
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
    }
    const selectedIds = currentState?.selectedNoteIds ?? new Set<number>();
    if (selectedIds.size === 0) return;
    if (event.key === "Delete") {
      event.preventDefault();
      if (selectedIds.size === 1) {
        handlers.onDeleteNote(Array.from(selectedIds)[0]);
      } else {
        handlers.onDropToTrash(Array.from(selectedIds));
      }
      return;
    }
    if (event.key === "F2" && selectedIds.size === 1) {
      event.preventDefault();
      handlers.onRenameNote(Array.from(selectedIds)[0]);
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-note-row]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (!Number.isFinite(id)) return;
    if (currentState && !currentState.selectedNoteIds.has(id)) {
      handlers.onSelectNotes([id], id);
      anchorNoteId = id;
    }
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

  const updateSelection = (prevIds: Set<number>, nextIds: Set<number>) => {
    prevIds.forEach((id) => {
      if (nextIds.has(id)) return;
      const row = root.querySelector<HTMLElement>(`[data-note-row="1"][data-note-id="${id}"]`);
      if (row) row.classList.remove("is-selected");
    });
    nextIds.forEach((id) => {
      if (prevIds.has(id)) return;
      const row = root.querySelector<HTMLElement>(`[data-note-row="1"][data-note-id="${id}"]`);
      if (row) row.classList.add("is-selected");
    });
  };

  return {
    update: (state: NotesListState) => {
      const prev = lastRendered;
      const shouldFullRender =
        !prev ||
        prev.notes !== state.notes ||
        prev.notesListView !== state.notesListView;
      const shouldUpdateHeader =
        !prev ||
        shouldFullRender ||
        prev.selectedNotebookId !== state.selectedNotebookId ||
        prev.selectedTagId !== state.selectedTagId ||
        prev.selectedTrash !== state.selectedTrash ||
        prev.tags !== state.tags ||
        prev.notes.length !== state.notes.length ||
        prev.notesSortBy !== state.notesSortBy ||
        prev.notesSortDir !== state.notesSortDir ||
        prev.notesListView !== state.notesListView;

      currentState = state;
      cleanupDrag();

      if (shouldFullRender) {
        root.innerHTML = renderNotesList(state);
        cacheHeaderRefs();
        anchorNoteId = state.selectedNoteId;
      } else if (prev.selectedNoteIds !== state.selectedNoteIds) {
        updateSelection(prev.selectedNoteIds, state.selectedNoteIds);
      }
      if (shouldUpdateHeader) {
        updateHeader(state);
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
