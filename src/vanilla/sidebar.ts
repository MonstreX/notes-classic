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
    <div class="flex-1 overflow-y-auto custom-scrollbar pr-1">
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
  const handleClick = (event: Event) => {
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

  return {
    update: (state: SidebarState) => {
      root.innerHTML = renderSidebar(state);
    },
    destroy: () => {
      root.removeEventListener("click", handleClick);
      root.innerHTML = "";
    },
  };
};
