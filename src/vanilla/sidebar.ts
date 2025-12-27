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
      <svg class="sidebar-icon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
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
      </svg>
    `;
  }
  return `
    <svg class="sidebar-icon" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
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
    </svg>
  `;
};

const renderChevron = (isExpanded: boolean) => `
  <svg width="14" height="14" viewBox="0 0 24 24" class="sidebar-chevron ${isExpanded ? "is-expanded" : ""}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
`;

const renderPlus = () => `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
`;

const renderAllNotesIcon = (isSelected: boolean) => {
  const stroke = isSelected ? "#00A82D" : "#6B7280";
  return `
    <svg class="sidebar-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
