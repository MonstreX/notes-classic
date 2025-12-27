export type ContextMenuNode = {
  id: number;
  name: string;
  type: "stack" | "notebook";
  children?: ContextMenuNode[];
};

type NoteMenuOptions = {
  x: number;
  y: number;
  noteId: number;
  nodes: ContextMenuNode[];
  onDelete: (id: number) => void;
  onMove: (noteId: number, notebookId: number | null) => void;
};

type NotebookMenuOptions = {
  x: number;
  y: number;
  notebookId: number;
  onDelete: (id: number) => void;
};

type TagMenuOptions = {
  x: number;
  y: number;
  tagId: number;
  onDelete: (id: number) => void;
};

let activeMenu: HTMLDivElement | null = null;
let cleanupMenu: (() => void) | null = null;

const closeMenu = () => {
  if (cleanupMenu) cleanupMenu();
  cleanupMenu = null;
  activeMenu = null;
};

const createItem = (label: string, action?: () => void, className?: string) => {
  const item = document.createElement("div");
  item.className = `context-menu-item ${className || ""}`.trim();
  item.textContent = label;
  if (action) {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
      closeMenu();
    });
  }
  return item;
};

const createSeparator = () => {
  const sep = document.createElement("div");
  sep.className = "context-menu-separator";
  return sep;
};

const createSubmenu = (label: string, children: HTMLElement[]) => {
  const item = document.createElement("div");
  item.className = "context-menu-item has-submenu";
  item.innerHTML = `
    <span>${label}</span>
    <span class="context-menu-caret">▶</span>
  `;
  const submenu = document.createElement("div");
  submenu.className = "context-menu submenu";
  children.forEach((child) => submenu.appendChild(child));
  item.appendChild(submenu);
  return item;
};

const buildMoveNodes = (
  nodes: ContextMenuNode[],
  noteId: number,
  onMove: (noteId: number, notebookId: number | null) => void
): HTMLElement[] => {
  return nodes.map((node) => {
    if (node.type === "stack") {
      const children = (node.children || [])
        .filter((child) => child.type === "notebook")
        .map((child) => createItem(child.name, () => onMove(noteId, child.id)));
      if (children.length === 0) {
        return createItem(node.name, undefined, "is-disabled");
      }
      return createSubmenu(node.name, children);
    }
    return createItem(node.name, () => onMove(noteId, node.id));
  });
};

export const openNoteContextMenu = ({ x, y, noteId, nodes, onDelete, onMove }: NoteMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem("Delete Note", () => onDelete(noteId), "is-danger"));
  menu.appendChild(createSeparator());

  const moveItems = [
    createItem("All Notes", () => onMove(noteId, null)),
    ...buildMoveNodes(nodes, noteId, onMove),
  ];
  menu.appendChild(createSubmenu("Move To", moveItems));

  document.body.appendChild(menu);
  activeMenu = menu;

  const adjustPosition = () => {
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  adjustPosition();

  const onOutsideClick = (event: MouseEvent) => {
    if (!activeMenu) return;
    if (event.target instanceof Node && activeMenu.contains(event.target)) return;
    closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };

  const onScroll = () => closeMenu();

  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("contextmenu", onOutsideClick, true);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  cleanupMenu = () => {
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("contextmenu", onOutsideClick, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    if (activeMenu) activeMenu.remove();
  };
};

export const openNotebookContextMenu = ({ x, y, notebookId, onDelete }: NotebookMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem("Delete Notebook", () => onDelete(notebookId), "is-danger"));

  document.body.appendChild(menu);
  activeMenu = menu;

  const adjustPosition = () => {
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  adjustPosition();

  const onOutsideClick = (event: MouseEvent) => {
    if (!activeMenu) return;
    if (event.target instanceof Node && activeMenu.contains(event.target)) return;
    closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };

  const onScroll = () => closeMenu();

  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("contextmenu", onOutsideClick, true);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  cleanupMenu = () => {
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("contextmenu", onOutsideClick, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    if (activeMenu) activeMenu.remove();
  };
};

export const openTagContextMenu = ({ x, y, tagId, onDelete }: TagMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem("Delete Tag", () => onDelete(tagId), "is-danger"));

  document.body.appendChild(menu);
  activeMenu = menu;

  const adjustPosition = () => {
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  adjustPosition();

  const onOutsideClick = (event: MouseEvent) => {
    if (!activeMenu) return;
    if (event.target instanceof Node && activeMenu.contains(event.target)) return;
    closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };

  const onScroll = () => closeMenu();

  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("contextmenu", onOutsideClick, true);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  cleanupMenu = () => {
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("contextmenu", onOutsideClick, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    if (activeMenu) activeMenu.remove();
  };
};
