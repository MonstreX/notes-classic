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
  onDeleteNotebook: (id: number) => void;
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

const renderNotebookIcon = (type: NotebookType, isSelected: boolean) => {
  const stroke = isSelected ? "#00A82D" : "#6B7280";
  if (type === "stack") {
    return `
      <svg class="shrink-0 w-[18px]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 7h20"></path>
        <path d="M2 12h20"></path>
        <path d="M2 17h20"></path>
      </svg>
    `;
  }
  return `
    <svg class="shrink-0 w-[18px]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20"></path>
      <path d="M4 2h16v20H4z"></path>
    </svg>
  `;
};

const renderChevron = (isExpanded: boolean) => `
  <svg width="14" height="14" viewBox="0 0 24 24" class="transition-transform ${isExpanded ? "rotate-90" : ""}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
`;

const renderPlus = () => `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
`;

const renderTrash = () => `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>
`;

const renderAllNotesIcon = (isSelected: boolean) => {
  const stroke = isSelected ? "#00A82D" : "#6B7280";
  return `
    <svg class="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
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
    <div class="w-full py-0.5 relative">
      <div
        class="flex items-center text-gray-400 p-1 rounded cursor-pointer group transition-all mx-1 hover:bg-[#2A2A2A] ${isSelected ? "bg-[#2A2A2A] text-white" : ""}"
        style="padding-left: ${level * 16 + 8}px;"
        data-action="select-notebook"
        data-notebook-id="${nb.id}"
        data-notebook-row="1"
        data-notebook-type="${nb.notebookType}"
        data-notebook-level="${level}"
      >
        <div class="flex items-center gap-3 overflow-hidden flex-1">
          ${renderNotebookIcon(nb.notebookType, isSelected)}
          <span class="text-sm truncate font-medium">${escapeHtml(nb.name)}</span>
          <span class="text-xs text-gray-500 font-medium">${noteCount}</span>
        </div>
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
          ${canHaveChildren ? `
            <button class="p-1 hover:text-white" data-action="add-notebook" data-notebook-id="${nb.id}" title="Add notebook">
              ${renderPlus()}
            </button>
            <button class="p-1 hover:text-white" data-action="toggle-notebook" data-notebook-id="${nb.id}" title="Expand/Collapse">
              ${renderChevron(isExpanded)}
            </button>
          ` : ""}
          <button class="p-1 hover:text-red-500" data-action="delete-notebook" data-notebook-id="${nb.id}" title="Delete notebook">
            ${renderTrash()}
          </button>
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
      const children = nb.notebookType === "stack"
        ? renderNotebookTree(notebooks, state, nb.id, level + 1, counts)
        : "";
      const isExpanded = state.expandedNotebooks.has(nb.id);
      return `
        <div data-notebook-node="${nb.id}">
          ${renderNotebookItem(nb, state, level, counts)}
          ${nb.notebookType === "stack" && isExpanded ? children : ""}
        </div>
      `;
    })
    .join("");
};

const renderSidebar = (state: SidebarState) => {
  const counts = buildCounts(state.notebooks, state.noteCounts);
  const allSelected = state.selectedNotebookId === null;
  return `
    <div class="flex-1 overflow-y-auto custom-scrollbar pr-1" data-sidebar-scroll="1">
      <div
        class="flex items-center gap-3 text-gray-400 p-2 rounded cursor-pointer mx-1 transition-all ${allSelected ? "bg-[#2A2A2A] text-white" : ""}"
        style="padding-left: 8px;"
        data-action="select-all"
      >
        ${renderAllNotesIcon(allSelected)}
        <span class="text-sm font-medium">All Notes</span>
        <span class="text-xs text-gray-500 font-medium">${state.totalNotes}</span>
      </div>
      <div class="mt-4 pt-4 pb-2 px-3 flex justify-between items-center text-gray-500 uppercase text-[10px] font-bold tracking-widest shrink-0">
        <span>Notebooks</span>
        <button class="cursor-pointer hover:text-white transition-colors" data-action="add-root" title="Create notebook">
          ${renderPlus()}
        </button>
      </div>
      <div class="rounded relative">
        ${renderNotebookTree(state.notebooks, state, null, 0, counts)}
      </div>
    </div>
  `;
};

export const mountSidebar = (root: HTMLElement, handlers: SidebarHandlers): SidebarInstance => {
  let currentState: SidebarState | null = null;
  let ignoreClick = false;
  let dragActive = false;
  let dragStarted = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragId = 0;
  let dragType: NotebookType = "notebook";
  let dragOverlay: HTMLDivElement | null = null;
  let dragLine: HTMLDivElement | null = null;
  let dragOverId: number | null = null;
  let dragPosition: "before" | "after" | "inside" | null = null;

  const ensureRootPosition = () => {
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
  };

  const getScrollEl = () => root.querySelector<HTMLElement>("[data-sidebar-scroll]");

  const cleanupDrag = () => {
    dragActive = false;
    dragStarted = false;
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
    document.body.style.cursor = "";
  };

  const findNotebook = (id: number) => currentState?.notebooks.find((nb) => nb.id === id) ?? null;

  const startDrag = (name: string, clientX: number, clientY: number) => {
    dragStarted = true;
    ignoreClick = true;
    dragOverlay = document.createElement("div");
    dragOverlay.className = "fixed z-[9999] pointer-events-none";
    dragOverlay.style.left = "0";
    dragOverlay.style.top = "0";
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
    dragOverlay.innerHTML = `
      <div class="px-4 py-2 bg-[#1A1A1A] text-white border border-[#2A2A2A] rounded shadow-sm text-sm opacity-70">
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
    if (action === "delete-notebook" && id !== null) {
      handlers.onDeleteNotebook(id);
    }
  };

  root.addEventListener("click", handleClick);

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
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragId = id;
    dragType = type;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragActive) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!dragStarted) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
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

  return {
    update: (state: SidebarState) => {
      currentState = state;
      root.innerHTML = renderSidebar(state);
      const scrollEl = getScrollEl();
      if (scrollEl && getComputedStyle(scrollEl).position === "static") {
        scrollEl.style.position = "relative";
      }
    },
    destroy: () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      cleanupDrag();
      root.innerHTML = "";
    },
  };
};
