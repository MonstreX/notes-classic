export interface NotesListItem {
  id: number;
  title: string;
  content: string;
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
}

export interface NotesListHandlers {
  onSelectNote: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onSearchChange: (value: string) => void;
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

const renderHeader = (state: NotesListState) => {
  const title = state.selectedNotebookId
    ? state.notebooks.find((n) => n.id === state.selectedNotebookId)?.name || "Notebooks"
    : "All Notes";
  return `
    <div class="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8] shrink-0">
      <h2 class="text-xs uppercase tracking-widest text-gray-500 font-bold mb-4 italic truncate">
        ${escapeHtml(title)}
      </h2>
      <div class="relative text-black">
        <svg class="absolute left-3 top-2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          placeholder="Search..."
          class="w-full bg-white border border-gray-200 rounded py-1.5 pl-9 pr-4 text-sm outline-none focus:border-[#00A82D]"
          value="${escapeHtml(state.searchTerm)}"
          data-action="search"
        />
      </div>
    </div>
  `;
};

const renderNoteRow = (note: NotesListItem, state: NotesListState) => {
  const isSelected = state.selectedNoteId === note.id;
  if (state.notesListView === "compact") {
    return `
      <div class="px-6 py-3 border-b border-gray-100 cursor-pointer relative bg-white ${isSelected ? "bg-[#F2F2F2]" : "group hover:bg-[#F8F8F8]"}" data-note-row="1" data-note-id="${note.id}">
        <div class="flex items-center justify-between text-black">
          <h3 class="font-normal text-sm truncate pr-4 ${isSelected ? "text-[#00A82D]" : ""}">
            ${escapeHtml(note.title || "Untitled")}
          </h3>
          <div class="text-[10px] text-gray-400 uppercase font-medium shrink-0">
            ${formatDate(note.updatedAt)}
          </div>
        </div>
      </div>
    `;
  }

  const excerpt = stripTags(note.content || "");
  return `
    <div class="px-6 py-5 border-b border-gray-100 cursor-pointer relative bg-white ${isSelected ? "ring-1 ring-[#00A82D] z-10" : "group hover:bg-[#F8F8F8]"}" data-note-row="1" data-note-id="${note.id}">
      <div class="flex justify-between items-start mb-1 text-black">
        <h3 class="font-semibold text-sm truncate pr-4 ${isSelected ? "text-[#00A82D]" : ""}">
          ${escapeHtml(note.title || "Untitled")}
        </h3>
        <button class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity" data-action="delete-note" data-note-id="${note.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </div>
      <p class="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">
        ${escapeHtml(excerpt || "No text")}
      </p>
      <div class="text-[10px] text-gray-400 uppercase font-medium">
        ${formatDate(note.updatedAt)}
      </div>
    </div>
  `;
};

const renderList = (state: NotesListState) => {
  const search = state.searchTerm.trim().toLowerCase();
  const filtered = search
    ? state.notes.filter((note) => note.title.toLowerCase().includes(search))
    : state.notes;
  return `
    <div class="flex-1 overflow-y-auto" data-notes-scroll="1">
      ${filtered.map((note) => renderNoteRow(note, state)).join("")}
    </div>
  `;
};

const renderNotesList = (state: NotesListState) => `
  <div class="flex flex-col h-full">
    ${renderHeader(state)}
    ${renderList(state)}
  </div>
`;

export const mountNotesList = (root: HTMLElement, handlers: NotesListHandlers): NotesListInstance => {
  let currentState: NotesListState | null = null;
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
      dragOverEl.classList.remove("bg-[#1F2B1F]", "text-white");
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
    dragOverlay.className = "fixed z-[9999] pointer-events-none";
    dragOverlay.style.left = "0";
    dragOverlay.style.top = "0";
    dragOverlay.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
    dragOverlay.innerHTML = `
      <div class="px-4 py-2 bg-white border border-gray-200 rounded shadow-sm text-sm text-black opacity-70">
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
      dragOverEl.classList.remove("bg-[#1F2B1F]", "text-white");
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
    dragOverEl.classList.add("bg-[#1F2B1F]", "text-white");
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
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragNoteId = id;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragActive) return;
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
    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (actionEl?.dataset.action === "delete-note") {
      event.stopPropagation();
      const id = Number(actionEl.dataset.noteId);
      if (Number.isFinite(id)) handlers.onDeleteNote(id);
      return;
    }
    const row = target.closest<HTMLElement>("[data-note-row]");
    if (!row) return;
    const id = Number(row.dataset.noteId);
    if (Number.isFinite(id)) handlers.onSelectNote(id);
  };

  const handleInput = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.dataset.action === "search") {
      handlers.onSearchChange(target.value);
    }
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
  root.addEventListener("input", handleInput);
  root.addEventListener("contextmenu", handleContextMenu);

  return {
    update: (state: NotesListState) => {
      currentState = state;
      cleanupDrag();
      root.innerHTML = renderNotesList(state);
    },
    destroy: () => {
      root.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      root.removeEventListener("click", handleClick);
      root.removeEventListener("input", handleInput);
      root.removeEventListener("contextmenu", handleContextMenu);
      cleanupDrag();
      root.innerHTML = "";
    },
  };
};
