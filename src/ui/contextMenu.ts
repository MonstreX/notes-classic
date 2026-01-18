import { t, tCount } from "../services/i18n";

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
  onDuplicate: (id: number) => void;
  onMove: (noteId: number, notebookId: number | null) => void;
  onRename: (id: number) => void;
  onExportPdf: (id: number) => void;
  onExportHtml: (id: number) => void;
};

type NotesMenuOptions = {
  x: number;
  y: number;
  noteIds: number[];
  nodes: ContextMenuNode[];
  onDelete: (ids: number[]) => void;
  onMove: (noteIds: number[], notebookId: number | null) => void;
  onExportPdf: (ids: number[]) => void;
  onExportHtml: (ids: number[]) => void;
};

type TrashNoteMenuOptions = {
  x: number;
  y: number;
  noteId: number;
  onRestore: (id: number) => void;
  onDelete: (id: number) => void;
};

type TrashNotesMenuOptions = {
  x: number;
  y: number;
  noteIds: number[];
  onRestore: (ids: number[]) => void;
  onDelete: (ids: number[]) => void;
};
type NotebookMenuOptions = {
  x: number;
  y: number;
  notebookId: number;
  onRename: (id: number) => void;
  onDelete: (id: number) => void;
};

type TagMenuOptions = {
  x: number;
  y: number;
  tagId: number;
  onRename: (id: number) => void;
  onDelete: (id: number) => void;
};

type TrashMenuOptions = {
  x: number;
  y: number;
  onRestoreAll: () => void;
  onEmptyTrash: () => void;
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

const buildMoveNodesForGroup = (
  nodes: ContextMenuNode[],
  noteIds: number[],
  onMove: (noteIds: number[], notebookId: number | null) => void
): HTMLElement[] => {
  return nodes.map((node) => {
    if (node.type === "stack") {
      const children = (node.children || [])
        .filter((child) => child.type === "notebook")
        .map((child) => createItem(child.name, () => onMove(noteIds, child.id)));
      if (children.length === 0) {
        return createItem(node.name, undefined, "is-disabled");
      }
      return createSubmenu(node.name, children);
    }
    return createItem(node.name, () => onMove(noteIds, node.id));
  });
};

export const openNoteContextMenu = ({ x, y, noteId, nodes, onDelete, onDuplicate, onMove, onRename, onExportPdf, onExportHtml }: NoteMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(t("menu.rename_note"), () => onRename(noteId)));
  menu.appendChild(createItem(t("menu.duplicate_note"), () => onDuplicate(noteId)));
  const moveItems = [
    createItem(t("menu.all_notes"), () => onMove(noteId, null)),
    ...buildMoveNodes(nodes, noteId, onMove),
  ];
  menu.appendChild(createSubmenu(t("menu.move_to"), moveItems));
  menu.appendChild(createSeparator());
  menu.appendChild(createSubmenu(t("menu.export"), [
    createItem(t("menu.export_pdf_native"), () => onExportPdf(noteId)),
    createItem(t("menu.export_html_one"), () => onExportHtml(noteId)),
  ]));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_note"), () => onDelete(noteId), "is-danger"));

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

type NoteMetaMenuOptions = {
  x: number;
  y: number;
  noteId: number;
  onExportPdfNative: (noteId: number) => void;
  onExportHtml: (noteId: number) => void;
};

export const openNoteMetaMenu = ({ x, y, noteId, onExportPdfNative, onExportHtml }: NoteMetaMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.appendChild(createItem(t("menu.export_pdf_native"), () => onExportPdfNative(noteId)));
  menu.appendChild(createItem(t("menu.export_html_one"), () => onExportHtml(noteId)));

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

  setTimeout(() => {
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("contextmenu", onOutsideClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
  }, 0);

  cleanupMenu = () => {
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("contextmenu", onOutsideClick);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    if (activeMenu) activeMenu.remove();
  };
};

export const openNotesContextMenu = ({ x, y, noteIds, nodes, onDelete, onMove, onExportPdf, onExportHtml }: NotesMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(tCount("menu.notes_selected", noteIds.length), undefined, "is-disabled"));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_notes"), () => onDelete(noteIds), "is-danger"));
  menu.appendChild(createSeparator());

  const moveItems = [
    createItem(t("menu.all_notes"), () => onMove(noteIds, null)),
    ...buildMoveNodesForGroup(nodes, noteIds, onMove),
  ];
  menu.appendChild(createSubmenu(t("menu.move_to"), moveItems));
  menu.appendChild(createSeparator());
  menu.appendChild(createSubmenu(t("menu.export"), [
    createItem(t("menu.export_pdf_native"), () => onExportPdf(noteIds)),
    createItem(t("menu.export_html_one"), () => onExportHtml(noteIds)),
  ]));

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
export const openTrashNoteContextMenu = ({ x, y, noteId, onRestore, onDelete }: TrashNoteMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(t("menu.restore_note"), () => onRestore(noteId)));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_permanently"), () => onDelete(noteId), "is-danger"));

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

export const openTrashNotesContextMenu = ({ x, y, noteIds, onRestore, onDelete }: TrashNotesMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(tCount("menu.notes_selected", noteIds.length), undefined, "is-disabled"));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.restore_notes"), () => onRestore(noteIds)));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_permanently"), () => onDelete(noteIds), "is-danger"));

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
export const openNotebookContextMenu = ({ x, y, notebookId, onRename, onDelete }: NotebookMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(t("menu.rename_notebook"), () => onRename(notebookId)));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_notebook"), () => onDelete(notebookId), "is-danger"));

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

export const openTagContextMenu = ({ x, y, tagId, onRename, onDelete }: TagMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(t("menu.rename_tag"), () => onRename(tagId)));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.delete_tag"), () => onDelete(tagId), "is-danger"));

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

export const openTrashContextMenu = ({ x, y, onRestoreAll, onEmptyTrash }: TrashMenuOptions) => {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";

  menu.appendChild(createItem(t("menu.restore_all"), () => onRestoreAll()));
  menu.appendChild(createSeparator());
  menu.appendChild(createItem(t("menu.empty_trash"), () => onEmptyTrash(), "is-danger"));

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
