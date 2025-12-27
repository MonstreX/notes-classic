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
  selectedNotebookId: number | null;
  expandedNotebooks: Set<number>;
  noteCounts: Map<number, number>;
  totalNotes: number;
}

export interface SidebarHandlers {
  onSelectNotebook: (id: number) => void;
  onSelectAll: () => void;
  onToggleNotebook: (id: number) => void;
  onCreateNotebook: (parentId: number | null) => void;
  onCreateNoteInNotebook: (id: number) => void;
  onDeleteNotebook: (id: number) => void;
  onNotebookContextMenu: (event: MouseEvent, id: number) => void;
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
          ${renderNotebookIcon(nb.notebookType, isSelected)}
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
  const allSelected = state.selectedNotebookId === null;
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
  let dragType: NotebookType = "notebook";
  let dragOverlay: HTMLDivElement | null = null;
  let dragLine: HTMLDivElement | null = null;
  let dragOverId: number | null = null;
  let dragPosition: "before" | "after" | "inside" | null = null;
  let prevExpanded = new Set<number>();

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

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button")) return;
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
      const nb = findNotebook(dragId);
      if (!nb) {
        cleanupDrag();
        return;
      }
      ensureRootPosition();
      startDrag(nb.name, event.clientX, event.clientY);
    }
    updateOverlay(event.clientX, event.clientY);
    const target = resolveDropTarget(event.clientX, event.clientY);
    updateDropLine(target);
    event.preventDefault();
  };

  const handlePointerUp = () => {
    if (!dragActive) return;
    if (!dragStarted && dragId) {
      ignoreClick = true;
      const nb = findNotebook(dragId);
      if (nb) {
        if (nb.notebookType === "stack") {
          handlers.onToggleNotebook(dragId);
        }
        handlers.onSelectNotebook(dragId);
      }
      cleanupDrag();
      return;
    }
    if (dragStarted && dragOverId !== null && dragPosition) {
      handlers.onMoveNotebook(dragId, dragOverId, dragPosition);
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

  const findSelectionEl = (id: number | null) => {
    if (id === null) {
      return root.querySelector<HTMLElement>("[data-action=\"select-all\"]");
    }
    return root.querySelector<HTMLElement>(`[data-action="select-notebook"][data-notebook-id="${id}"]`);
  };

  const updateSelection = (prevId: number | null, nextId: number | null) => {
    if (prevId === nextId) return;
    const prevEl = findSelectionEl(prevId);
    if (prevEl) prevEl.classList.remove("is-selected");
    const nextEl = findSelectionEl(nextId);
    if (nextEl) nextEl.classList.add("is-selected");
  };

  return {
    update: (state: SidebarState) => {
      const prev = lastRendered;
      currentState = state;
      const shouldFullRender =
        !prev ||
        prev.notebooks !== state.notebooks ||
        prev.expandedNotebooks !== state.expandedNotebooks ||
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
        }
      } else {
        updateSelection(prev.selectedNotebookId, state.selectedNotebookId);
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
      lastRendered = state;
    },
    destroy: () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("contextmenu", handleContextMenu);
      root.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      cleanupDrag();
      root.innerHTML = "";
    },
  };
};
