import type { Tag } from "../state/types";

export type NotebookType = "stack" | "notebook";

export interface SidebarNotebook {
  id: number;
  name: string;
  parentId: number | null;
  notebookType: NotebookType;
  sortOrder: number;
}

export interface SidebarState {
  notebooks: SidebarNotebook[];
  tags: Tag[];
  selectedTagId: number | null;
  expandedTags: Set<number>;
  tagsSectionExpanded: boolean;
  selectedNotebookId: number | null;
  expandedNotebooks: Set<number>;
  noteCounts: Map<number, number>;
  totalNotes: number;
}

export interface SidebarHandlers {
  onSelectNotebook: (id: number) => void;
  onSelectAll: () => void;
  onSelectTag: (id: number) => void;
  onToggleNotebook: (id: number) => void;
  onToggleTag: (id: number) => void;
  onCreateNotebook: (parentId: number | null) => void;
  onCreateTag: (parentId: number | null) => void;
  onToggleTagsSection: () => void;
  onCreateNoteInNotebook: (id: number) => void;
  onDeleteNotebook: (id: number) => void;
  onTagContextMenu: (event: MouseEvent, id: number) => void;
  onNotebookContextMenu: (event: MouseEvent, id: number) => void;
  onMoveTag: (tagId: number, parentId: number | null) => void;
  onMoveNotebook: (activeId: number, overId: number, position: "before" | "after" | "inside") => void;
}

export interface SidebarInstance {
  update: (state: SidebarState) => void;
  destroy: () => void;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderNotebookIcon = (type: NotebookType) => {
  if (type === "stack") {
    return `
      <svg class="sidebar-icon" aria-hidden="true">
        <use href="#icon-stack"></use>
      </svg>
    `;
  }
  return `
    <svg class="sidebar-icon" aria-hidden="true">
      <use href="#icon-notebook"></use>
    </svg>
  `;
};

const renderTagIcon = () => `
  <svg class="sidebar-icon sidebar-icon--tag" aria-hidden="true">
    <use href="#icon-tag"></use>
  </svg>
`;

const renderChevron = (isExpanded: boolean) => `
  <svg class="sidebar-chevron ${isExpanded ? "is-expanded" : ""}" width="14" height="14" aria-hidden="true">
    <use href="#icon-chevron"></use>
  </svg>
`;

const renderPlus = () => `
  <svg width="14" height="14" aria-hidden="true">
    <use href="#icon-plus"></use>
  </svg>
`;

const renderAllNotesIcon = (isSelected: boolean) => {
  const color = isSelected ? "#00A82D" : "#6B7280";
  return `
    <svg class="sidebar-icon" width="18" height="18" aria-hidden="true" style="color: ${color}">
      <use href="#icon-note"></use>
    </svg>
  `;
};

const getTagChildren = (tags: Tag[], parentId: number | null) =>
  tags
    .filter((tag) => tag.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));

const renderTagItem = (
  tag: Tag,
  state: SidebarState,
  level: number,
  hasChildren: boolean
) => {
  const isSelected = state.selectedTagId === tag.id;
  const isExpanded = state.expandedTags.has(tag.id);
  return `
    <div class="sidebar-row">
      <div
        class="sidebar-item sidebar-item--compact ${isSelected ? "is-selected" : ""}"
        style="padding-left: ${level * 16 + 8}px;"
        data-action="select-tag"
        data-tag-id="${tag.id}"
        data-tag-row="1"
        data-tag-level="${level}"
        data-tag-has-children="${hasChildren ? "1" : "0"}"
      >
        <div class="sidebar-item__content">
          ${renderTagIcon()}
          <span class="sidebar-item__label">${escapeHtml(tag.name)}</span>
        </div>
        <div class="sidebar-item__actions">
          <button class="sidebar-action" data-action="add-tag" data-tag-id="${tag.id}" title="Add tag">
            ${renderPlus()}
          </button>
          ${
            hasChildren
              ? `<button class="sidebar-action" data-action="toggle-tag" data-tag-id="${tag.id}" title="Expand/Collapse">
                  ${renderChevron(isExpanded)}
                </button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
};

const renderTagTree = (
  tags: Tag[],
  state: SidebarState,
  parentId: number | null,
  level: number
): string => {
  return getTagChildren(tags, parentId)
    .map((tag) => {
      const children = getTagChildren(tags, tag.id);
      const isExpanded = state.expandedTags.has(tag.id);
      return `
        <div data-tag-node="${tag.id}">
          ${renderTagItem(tag, state, level, children.length > 0)}
          ${
            children.length > 0
              ? `<div class="tag-children" data-expanded="${isExpanded ? "true" : "false"}">
                  ${renderTagTree(tags, state, tag.id, level + 1)}
                </div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
};

const buildCounts = (notebooks: SidebarNotebook[], noteCounts: Map<number, number>) => {
  const notebookCounts = new Map<number, number>(noteCounts);
  const stackCounts = new Map<number, number>();
  for (const nb of notebooks) {
    if (nb.notebookType === "stack") stackCounts.set(nb.id, 0);
  }
  for (const nb of notebooks) {
    if (nb.notebookType !== "notebook" || nb.parentId === null) continue;
    const count = noteCounts.get(nb.id) ?? 0;
    stackCounts.set(nb.parentId, (stackCounts.get(nb.parentId) ?? 0) + count);
  }
  return { notebookCounts, stackCounts };
};

const getOrderedChildren = (notebooks: SidebarNotebook[], parentId: number | null) => {
  const typeFilter: NotebookType = parentId === null ? "stack" : "notebook";
  return notebooks
    .filter((nb) => nb.parentId === parentId && nb.notebookType === typeFilter)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
};

const renderNotebookItem = (
  nb: SidebarNotebook,
  state: SidebarState,
  level: number,
  counts: { notebookCounts: Map<number, number>; stackCounts: Map<number, number> }
) => {
  const isSelected = state.selectedNotebookId === nb.id;
  const isExpanded = state.expandedNotebooks.has(nb.id);
  const canHaveChildren = nb.notebookType === "stack";
  const noteCount = nb.notebookType === "stack"
    ? (counts.stackCounts.get(nb.id) ?? 0)
    : (counts.notebookCounts.get(nb.id) ?? 0);

  return `
    <div class="sidebar-row">
      <div
        class="sidebar-item sidebar-item--compact ${isSelected ? "is-selected" : ""}"
        style="padding-left: ${level * 16 + 8}px;"
        data-action="select-notebook"
        data-notebook-id="${nb.id}"
        data-notebook-row="1"
        data-notebook-type="${nb.notebookType}"
        data-notebook-level="${level}"
      >
        <div class="sidebar-item__content">
          ${renderNotebookIcon(nb.notebookType)}
          <span class="sidebar-item__label">${escapeHtml(nb.name)}</span>
          <span class="sidebar-item__count">${noteCount}</span>
        </div>
        <div class="sidebar-item__actions">
          ${canHaveChildren ? `
            <button class="sidebar-action" data-action="add-notebook" data-notebook-id="${nb.id}" title="Add notebook">
              ${renderPlus()}
            </button>
            <button class="sidebar-action" data-action="toggle-notebook" data-notebook-id="${nb.id}" title="Expand/Collapse">
              ${renderChevron(isExpanded)}
            </button>
          ` : `
            <button class="sidebar-action" data-action="add-note" data-notebook-id="${nb.id}" title="Add note">
              ${renderPlus()}
            </button>
          `}
        </div>
      </div>
    </div>
  `;
};

const renderNotebookTree = (
  notebooks: SidebarNotebook[],
  state: SidebarState,
  parentId: number | null,
  level: number,
  counts: { notebookCounts: Map<number, number>; stackCounts: Map<number, number> }
): string => {
  return getOrderedChildren(notebooks, parentId)
    .map((nb) => {
      const isExpanded = state.expandedNotebooks.has(nb.id);
      const children = nb.notebookType === "stack"
        ? renderNotebookTree(notebooks, state, nb.id, level + 1, counts)
        : "";
      return `
        <div data-notebook-node="${nb.id}">
          ${renderNotebookItem(nb, state, level, counts)}
          ${
            nb.notebookType === "stack"
              ? `<div class="notebook-children" data-expanded="${isExpanded ? "true" : "false"}">${children}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
};

const renderSidebar = (state: SidebarState) => {
  const counts = buildCounts(state.notebooks, state.noteCounts);
  const allSelected = state.selectedNotebookId === null && state.selectedTagId === null;
  return `
    <div class="sidebar-scroll custom-scrollbar" data-sidebar-scroll="1">
      <div class="sidebar-section">
        <span>Notebooks</span>
        <button class="sidebar-section__action" data-action="add-root" title="Create notebook">
          ${renderPlus()}
        </button>
      </div>
      <div
        class="sidebar-item ${allSelected ? "is-selected" : ""}"
        style="padding-left: 8px;"
        data-action="select-all"
        data-drop-all="1"
      >
        ${renderAllNotesIcon(allSelected)}
        <span class="sidebar-item__label">All Notes</span>
        <span class="sidebar-item__count">${state.totalNotes}</span>
      </div>
      <div class="sidebar-tree">
        ${renderNotebookTree(state.notebooks, state, null, 0, counts)}
      </div>
      <div class="sidebar-section" data-tags-section="1" data-action="toggle-tags-section">
        <span class="sidebar-section__title" data-action="toggle-tags-section">Tags</span>
        <div class="sidebar-section__actions">
          <button class="sidebar-section__action" data-action="add-tag-root" title="Create tag">
            ${renderPlus()}
          </button>
          <button class="sidebar-section__action" data-action="toggle-tags-section" title="Expand/Collapse tags">
            ${renderChevron(state.tagsSectionExpanded)}
          </button>
        </div>
      </div>
      <div class="sidebar-tree sidebar-tree--tags" data-expanded="${state.tagsSectionExpanded ? "true" : "false"}">
        ${renderTagTree(state.tags, state, null, 0)}
      </div>
    </div>
  `;
};

export const mountSidebar = (root: HTMLElement, handlers: SidebarHandlers): SidebarInstance => {
  let currentState: SidebarState | null = null;
  let lastRendered: SidebarState | null = null;
  let ignoreClick = false;
  let dragActive = false;
  let dragStarted = false;
  let dragHoldTimer: number | null = null;
  let dragHoldReady = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragId = 0;
  let dragType: NotebookType | "tag" = "notebook";
  let dragOverlay: HTMLDivElement | null = null;
  let dragLine: HTMLDivElement | null = null;
  let dragOverId: number | null = null;
  let dragPosition: "before" | "after" | "inside" | null = null;
  let dragTagOverId: number | null = null;
  let dragTagOverRoot = false;
  let dragTagOverEl: HTMLElement | null = null;
  let dragTagsRootEl: HTMLElement | null = null;
  let prevExpanded = new Set<number>();
  let prevExpandedTags = new Set<number>();

  const ensureRootPosition = () => {
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
  };

  const getScrollEl = () => root.querySelector<HTMLElement>("[data-sidebar-scroll]");

  const cleanupDrag = () => {
    dragActive = false;
    dragStarted = false;
    dragHoldReady = false;
    if (dragHoldTimer !== null) {
      window.clearTimeout(dragHoldTimer);
      dragHoldTimer = null;
    }
    dragOverId = null;
    dragPosition = null;
    dragTagOverId = null;
    dragTagOverRoot = false;
    if (dragTagOverEl) {
      dragTagOverEl.classList.remove("is-drag-over");
      dragTagOverEl = null;
    }
    if (dragTagsRootEl) {
      dragTagsRootEl.classList.remove("is-drag-over");
      dragTagsRootEl = null;
    }
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
    if (dragLine) {
      dragLine.remove();
      dragLine = null;
    }
    document.body.classList.remove("is-dragging");
    document.body.style.cursor = "";
  };

  const findNotebook = (id: number) => currentState?.notebooks.find((nb) => nb.id === id) ?? null;
  const findTag = (id: number) => currentState?.tags.find((tag) => tag.id === id) ?? null;
  const hasTagChildren = (id: number) => currentState?.tags.some((tag) => tag.parentId === id) ?? false;

  const startDrag = (name: string, clientX: number, clientY: number) => {
    dragStarted = true;
    ignoreClick = true;
    document.body.classList.add("is-dragging");
    dragOverlay = document.createElement("div");
    dragOverlay.className = "sidebar-drag";
    dragOverlay.style.left = "0";
    dragOverlay.style.top = "0";
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
    dragOverlay.innerHTML = `
      <div class="sidebar-drag__item">
        ${escapeHtml(name)}
      </div>
    `;
    document.body.appendChild(dragOverlay);

    if (dragType !== "tag") {
      const scrollEl = getScrollEl();
      if (scrollEl) {
        dragLine = document.createElement("div");
        dragLine.style.position = "absolute";
        dragLine.style.height = "2px";
        dragLine.style.background = "#00A82D";
        dragLine.style.pointerEvents = "none";
        dragLine.style.borderRadius = "2px";
        scrollEl.appendChild(dragLine);
      }
    } else if (dragLine) {
      dragLine.remove();
      dragLine = null;
    }
    document.body.style.cursor = "grabbing";
  };

  const updateOverlay = (clientX: number, clientY: number) => {
    if (!dragOverlay) return;
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
  };

  const resolveDropTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const row = element?.closest<HTMLElement>("[data-notebook-row]");
    if (!row || !root.contains(row)) return null;
    const overId = Number(row.dataset.notebookId);
    if (!Number.isFinite(overId) || overId === dragId) return null;
    const overType = row.dataset.notebookType as NotebookType | undefined;
    if (!overType) return null;
    const rect = row.getBoundingClientRect();
    let position: "before" | "after" | "inside" | null = null;

    if (dragType === "stack") {
      if (overType !== "stack") return null;
      const midTop = rect.top + rect.height * 0.33;
      position = clientY < midTop ? "before" : "after";
    } else {
      if (overType === "stack") {
        position = "inside";
      } else if (overType === "notebook") {
        const mid = rect.top + rect.height / 2;
        position = clientY < mid ? "before" : "after";
      }
    }

    if (!position) return null;
    const level = Number(row.dataset.notebookLevel || "0");
    return { overId, position, rect, level };
  };

  const resolveTagDropTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const row = element?.closest<HTMLElement>("[data-tag-row]");
    if (row && root.contains(row)) {
      const overId = Number(row.dataset.tagId);
      if (!Number.isFinite(overId) || overId === dragId) return null;
      const rect = row.getBoundingClientRect();
      const level = Number(row.dataset.tagLevel || "0");
      return { overId, rect, level, rootDrop: false, row };
    }
    const tagsRoot = element?.closest<HTMLElement>(".sidebar-tree--tags");
    if (tagsRoot && root.contains(tagsRoot)) {
      if (tagsRoot.dataset.expanded === "false") return null;
      const rect = tagsRoot.getBoundingClientRect();
      return { overId: null, rect, level: 0, rootDrop: true, row: null, rootEl: tagsRoot };
    }
    const tagsSection = element?.closest<HTMLElement>("[data-tags-section]");
    if (tagsSection && root.contains(tagsSection)) {
      const rect = tagsSection.getBoundingClientRect();
      return { overId: null, rect, level: 0, rootDrop: true, row: null, rootEl: tagsSection };
    }
    return null;
  };

  const updateDropLine = (target: { overId: number; position: "before" | "after" | "inside"; rect: DOMRect; level: number } | null) => {
    if (!dragLine) return;
    if (!target) {
      dragLine.style.display = "none";
      dragOverId = null;
      dragPosition = null;
      return;
    }
    const scrollEl = getScrollEl();
    if (!scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const baseIndent = target.level * 16 + 8;
    const indent = target.position === "inside" ? baseIndent + 16 : baseIndent;
    const y = (target.position === "before" ? target.rect.top : target.rect.bottom) - scrollRect.top + scrollEl.scrollTop;
    const left = target.rect.left - scrollRect.left + indent;
    const right = target.rect.right - scrollRect.left - 8;
    const width = Math.max(10, right - left);
    dragLine.style.display = "block";
    dragLine.style.top = `${y - 1}px`;
    dragLine.style.left = `${left}px`;
    dragLine.style.width = `${width}px`;
    dragOverId = target.overId;
    dragPosition = target.position;
  };

  const updateTagDropLine = (target: { overId: number | null; rect: DOMRect; level: number; rootDrop: boolean; row?: HTMLElement | null; rootEl?: HTMLElement | null } | null) => {
    if (dragLine) {
      dragLine.style.display = "none";
    }
    if (!target) {
      dragTagOverId = null;
      dragTagOverRoot = false;
      if (dragTagOverEl) {
        dragTagOverEl.classList.remove("is-drag-over");
        dragTagOverEl = null;
      }
      if (dragTagsRootEl) {
        dragTagsRootEl.classList.remove("is-drag-over");
        dragTagsRootEl = null;
      }
      return;
    }
    dragTagOverId = target.overId;
    dragTagOverRoot = target.rootDrop;
    if (dragTagOverEl && dragTagOverEl !== target.row) {
      dragTagOverEl.classList.remove("is-drag-over");
    }
    dragTagOverEl = target.row ?? null;
    if (dragTagOverEl) {
      dragTagOverEl.classList.add("is-drag-over");
    }
    if (dragTagsRootEl && dragTagsRootEl !== target.rootEl) {
      dragTagsRootEl.classList.remove("is-drag-over");
    }
    dragTagsRootEl = target.rootEl ?? null;
    if (dragTagsRootEl) {
      dragTagsRootEl.classList.add("is-drag-over");
    }
  };

  const handleClick = (event: Event) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const idRaw = actionEl.dataset.notebookId;
    const id = idRaw ? Number(idRaw) : null;
    const tagIdRaw = actionEl.dataset.tagId;
    const tagId = tagIdRaw ? Number(tagIdRaw) : null;

    if (action === "select-all") {
      handlers.onSelectAll();
      return;
    }
    if (action === "select-notebook" && id !== null) {
      const type = actionEl.dataset.notebookType as NotebookType | undefined;
      if (type === "stack") {
        handlers.onToggleNotebook(id);
      }
      handlers.onSelectNotebook(id);
      return;
    }
    if (action === "toggle-notebook" && id !== null) {
      handlers.onToggleNotebook(id);
      return;
    }
    if (action === "add-notebook") {
      handlers.onCreateNotebook(id);
      return;
    }
    if (action === "add-root") {
      handlers.onCreateNotebook(null);
      return;
    }
    if (action === "add-note" && id !== null) {
      handlers.onCreateNoteInNotebook(id);
      return;
    }
      if (action === "toggle-tags-section") {
        handlers.onToggleTagsSection();
        return;
      }
    if (action === "select-tag" && tagId !== null) {
      if (actionEl.dataset.tagHasChildren === "1") {
        handlers.onToggleTag(tagId);
      }
      handlers.onSelectTag(tagId);
      return;
    }
    if (action === "toggle-tag" && tagId !== null) {
      handlers.onToggleTag(tagId);
      return;
    }
    if (action === "add-tag") {
      handlers.onCreateTag(tagId);
      return;
    }
    if (action === "add-tag-root") {
      handlers.onCreateTag(null);
      return;
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-notebook-row]");
    if (!row) return;
    const id = Number(row.dataset.notebookId);
    if (!Number.isFinite(id)) return;
    handlers.onNotebookContextMenu(event, id);
  };

  root.addEventListener("click", handleClick);
  root.addEventListener("contextmenu", handleContextMenu);

  const handleTagContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>("[data-tag-row]");
    if (!row) return;
    const id = Number(row.dataset.tagId);
    if (!Number.isFinite(id)) return;
    handlers.onTagContextMenu(event, id);
  };
  root.addEventListener("contextmenu", handleTagContextMenu);

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button")) return;
    const tagRow = target.closest<HTMLElement>("[data-tag-row]");
    if (tagRow && root.contains(tagRow)) {
      const id = Number(tagRow.dataset.tagId);
      if (!Number.isFinite(id)) return;
      dragActive = true;
      dragStarted = false;
      dragHoldReady = false;
      document.body.classList.add("is-dragging");
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragId = id;
      dragType = "tag";
      event.preventDefault();
      if (dragHoldTimer !== null) {
        window.clearTimeout(dragHoldTimer);
      }
      dragHoldTimer = window.setTimeout(() => {
        dragHoldReady = true;
      }, 180);
      return;
    }
    const row = target.closest<HTMLElement>("[data-notebook-row]");
    if (!row || !root.contains(row)) return;
    const id = Number(row.dataset.notebookId);
    if (!Number.isFinite(id)) return;
    const type = row.dataset.notebookType as NotebookType | undefined;
    if (!type) return;
    dragActive = true;
    dragStarted = false;
    dragHoldReady = false;
    document.body.classList.add("is-dragging");
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragId = id;
    dragType = type;
    event.preventDefault();
    if (dragHoldTimer !== null) {
      window.clearTimeout(dragHoldTimer);
    }
    dragHoldTimer = window.setTimeout(() => {
      dragHoldReady = true;
    }, 180);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragActive) return;
    event.preventDefault();
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!dragStarted) {
      if (!dragHoldReady) return;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (dragType === "tag") {
        const tag = findTag(dragId);
        if (!tag) {
          cleanupDrag();
          return;
        }
        ensureRootPosition();
        startDrag(tag.name, event.clientX, event.clientY);
      } else {
        const nb = findNotebook(dragId);
        if (!nb) {
          cleanupDrag();
          return;
        }
        ensureRootPosition();
        startDrag(nb.name, event.clientX, event.clientY);
      }
    }
    updateOverlay(event.clientX, event.clientY);
    if (dragType === "tag") {
      const target = resolveTagDropTarget(event.clientX, event.clientY);
      updateTagDropLine(target);
    } else {
      const target = resolveDropTarget(event.clientX, event.clientY);
      updateDropLine(target);
    }
    event.preventDefault();
  };

  const handlePointerUp = () => {
    if (!dragActive) return;
    if (!dragStarted && dragId) {
      ignoreClick = true;
      if (dragType === "tag") {
        const tag = findTag(dragId);
        if (tag) {
          if (hasTagChildren(dragId)) {
            handlers.onToggleTag(dragId);
          }
          handlers.onSelectTag(dragId);
        }
      } else {
        const nb = findNotebook(dragId);
        if (nb) {
          if (nb.notebookType === "stack") {
            handlers.onToggleNotebook(dragId);
          }
          handlers.onSelectNotebook(dragId);
        }
      }
      cleanupDrag();
      return;
    }
    if (dragStarted) {
      if (dragType === "tag") {
        if (dragTagOverId !== null) {
          handlers.onMoveTag(dragId, dragTagOverId);
        } else if (dragTagOverRoot) {
          handlers.onMoveTag(dragId, null);
        }
      } else if (dragOverId !== null && dragPosition) {
        handlers.onMoveNotebook(dragId, dragOverId, dragPosition);
      }
    }
    cleanupDrag();
  };

  const handlePointerCancel = () => {
    if (!dragActive) return;
    cleanupDrag();
  };

  root.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);

  const findSelectionEl = (id: number | null, allowAll: boolean) => {
    if (id === null) {
      if (!allowAll) return null;
      return root.querySelector<HTMLElement>("[data-action=\"select-all\"]");
    }
    return root.querySelector<HTMLElement>(`[data-action="select-notebook"][data-notebook-id="${id}"]`);
  };

  const findTagSelectionEl = (id: number | null) => {
    if (id === null) return null;
    return root.querySelector<HTMLElement>(`[data-action="select-tag"][data-tag-id="${id}"]`);
  };

  const updateSelection = (prevId: number | null, nextId: number | null, allowAll: boolean) => {
    if (prevId === nextId) return;
    if (!allowAll) {
      const allEl = root.querySelector<HTMLElement>("[data-action=\"select-all\"]");
      if (allEl) allEl.classList.remove("is-selected");
    }
    const prevEl = findSelectionEl(prevId, allowAll);
    if (prevEl) prevEl.classList.remove("is-selected");
    const nextEl = findSelectionEl(nextId, allowAll);
    if (nextEl) nextEl.classList.add("is-selected");
  };

  const updateTagSelection = (prevId: number | null, nextId: number | null) => {
    if (prevId === nextId) return;
    const prevEl = findTagSelectionEl(prevId);
    if (prevEl) prevEl.classList.remove("is-selected");
    const nextEl = findTagSelectionEl(nextId);
    if (nextEl) nextEl.classList.add("is-selected");
  };

  return {
    update: (state: SidebarState) => {
      const prev = lastRendered;
      currentState = state;
      const shouldFullRender =
        !prev ||
        prev.notebooks !== state.notebooks ||
        prev.tags !== state.tags ||
        prev.expandedNotebooks !== state.expandedNotebooks ||
        prev.expandedTags !== state.expandedTags ||
        prev.tagsSectionExpanded !== state.tagsSectionExpanded ||
        prev.noteCounts !== state.noteCounts ||
        prev.totalNotes !== state.totalNotes;

      if (shouldFullRender) {
        const scrollTop = getScrollEl()?.scrollTop ?? 0;
        root.innerHTML = renderSidebar(state);
        const scrollEl = getScrollEl();
        if (scrollEl) {
          scrollEl.scrollTop = scrollTop;
          if (getComputedStyle(scrollEl).position === "static") {
            scrollEl.style.position = "relative";
          }
          requestAnimationFrame(() => {
            scrollEl.scrollTop = scrollTop;
          });
        }
      } else {
        updateSelection(prev.selectedNotebookId, state.selectedNotebookId, state.selectedTagId === null);
        updateTagSelection(prev.selectedTagId, state.selectedTagId);
      }

      if (shouldFullRender) {
        const nextExpanded = new Set(state.expandedNotebooks);
        const childrenEls = root.querySelectorAll<HTMLElement>(".notebook-children");
        childrenEls.forEach((el) => {
          const node = el.closest<HTMLElement>("[data-notebook-node]");
          if (!node) return;
          const id = Number(node.dataset.notebookNode);
          if (!Number.isFinite(id)) return;
          const isExpanded = nextExpanded.has(id);
          const wasExpanded = prevExpanded.has(id);

          if (isExpanded) {
            if (!wasExpanded) {
              el.style.maxHeight = "0px";
              el.style.opacity = "0";
              requestAnimationFrame(() => {
                el.style.maxHeight = `${el.scrollHeight}px`;
                el.style.opacity = "1";
              });
            } else {
              el.style.maxHeight = `${el.scrollHeight}px`;
              el.style.opacity = "1";
            }
          } else {
            if (wasExpanded) {
              el.style.maxHeight = `${el.scrollHeight}px`;
              el.style.opacity = "1";
              requestAnimationFrame(() => {
                el.style.maxHeight = "0px";
                el.style.opacity = "0";
              });
            } else {
              el.style.maxHeight = "0px";
              el.style.opacity = "0";
            }
          }
        });
        prevExpanded = nextExpanded;
      }

      if (shouldFullRender) {
        const nextExpanded = new Set(state.expandedTags);
        const childrenEls = root.querySelectorAll<HTMLElement>(".tag-children");
        childrenEls.forEach((el) => {
          const node = el.closest<HTMLElement>("[data-tag-node]");
          if (!node) return;
          const id = Number(node.dataset.tagNode);
          if (!Number.isFinite(id)) return;
          const isExpanded = nextExpanded.has(id);
          const wasExpanded = prevExpandedTags.has(id);

          if (isExpanded) {
            if (!wasExpanded) {
              el.style.maxHeight = "0px";
              el.style.opacity = "0";
              requestAnimationFrame(() => {
                el.style.maxHeight = `${el.scrollHeight}px`;
                el.style.opacity = "1";
              });
            } else {
              el.style.maxHeight = `${el.scrollHeight}px`;
              el.style.opacity = "1";
            }
          } else {
            if (wasExpanded) {
              el.style.maxHeight = `${el.scrollHeight}px`;
              el.style.opacity = "1";
              requestAnimationFrame(() => {
                el.style.maxHeight = "0px";
                el.style.opacity = "0";
              });
            } else {
              el.style.maxHeight = "0px";
              el.style.opacity = "0";
            }
          }
        });
        prevExpandedTags = nextExpanded;
      }

        if (shouldFullRender) {
          const tagsTree = root.querySelector<HTMLElement>(".sidebar-tree--tags");
          if (tagsTree) {
            const isExpanded = tagsTree.dataset.expanded === "true";
            const wasExpanded = prev?.tagsSectionExpanded ?? true;
          if (isExpanded) {
            if (!wasExpanded) {
              tagsTree.style.maxHeight = "0px";
              tagsTree.style.opacity = "0";
              requestAnimationFrame(() => {
                tagsTree.style.maxHeight = `${tagsTree.scrollHeight}px`;
                tagsTree.style.opacity = "1";
              });
            } else {
              tagsTree.style.maxHeight = `${tagsTree.scrollHeight}px`;
              tagsTree.style.opacity = "1";
            }
          } else {
            if (wasExpanded) {
              tagsTree.style.maxHeight = `${tagsTree.scrollHeight}px`;
              tagsTree.style.opacity = "1";
              requestAnimationFrame(() => {
                tagsTree.style.maxHeight = "0px";
                tagsTree.style.opacity = "0";
              });
              } else {
                tagsTree.style.maxHeight = "0px";
                tagsTree.style.opacity = "0";
              }
            }
            if (isExpanded && !wasExpanded) {
              const scrollEl = getScrollEl();
              const tagsSection = root.querySelector<HTMLElement>("[data-tags-section]");
              if (scrollEl && tagsSection) {
                const ensureVisible = () => {
                  const sectionTop = tagsSection.offsetTop;
                  const sectionBottom = sectionTop + tagsSection.offsetHeight + tagsTree.offsetHeight;
                  const viewTop = scrollEl.scrollTop;
                  const viewBottom = viewTop + scrollEl.clientHeight;
                  if (sectionBottom > viewBottom) {
                    scrollEl.scrollTop = Math.max(0, sectionBottom - scrollEl.clientHeight);
                  } else if (sectionTop < viewTop) {
                    scrollEl.scrollTop = Math.max(0, sectionTop - 8);
                  }
                };
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    ensureVisible();
                    window.setTimeout(ensureVisible, 220);
                  });
                });
              }
            }
          }
        }
      lastRendered = state;
    },
    destroy: () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("contextmenu", handleContextMenu);
      root.removeEventListener("contextmenu", handleTagContextMenu);
      root.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      cleanupDrag();
      root.innerHTML = "";
    },
  };
};
