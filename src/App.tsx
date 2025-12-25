import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { ask } from "@tauri-apps/api/dialog";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/dialog";
import { Plus, Trash2, Search, FileText, Book, FolderPlus, ChevronRight, BookOpen } from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Menu, Item, Submenu, Separator, useContextMenu } from "react-contexify";
import Editor from "./components/Editor";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface Notebook { id: number; name: string; parentId: number | null; notebookType: "stack" | "notebook"; sortOrder: number; }
interface Note { id: number; title: string; content: string; updatedAt: number; notebookId: number | null; }
type NotesListView = "detailed" | "compact";

const STORAGE_KEY = "notes_classic_v10_stable";

const NOTE_CONTEXT_MENU_ID = "note-context-menu";

// --- NOTEBOOK ITEM ---
function NotebookItem({ notebook, noteCount, isSelected, level, onSelect, onAddSub, onDelete, isExpanded, onToggle, dragIndicator, isNoteDragging }: any) {
  const { setNodeRef, isOver } = useDroppable({
    id: `notebook-${notebook.id}`,
    data: { notebookId: notebook.id, dropType: "notebook" },
  });

  const canHaveChildren = notebook.notebookType === "stack";

  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `notebook-drag-${notebook.id}`,
    data: { type: "notebook", notebookId: notebook.id, notebookType: notebook.notebookType },
  });
  const dragStyle = { transform: CSS.Translate.toString(transform), touchAction: "none" as const };
  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDragRef(node);
  };

  useEffect(() => {
    if (isOver && !isExpanded && canHaveChildren) {
      onToggle(notebook.id);
    }
  }, [isOver, isExpanded, notebook.id, onToggle, canHaveChildren]);

  return (
    <div ref={setRefs} style={dragStyle} {...attributes} {...listeners} className={cn("w-full py-0.5 relative", isDragging && "opacity-40")}>
      <div 
        onClick={() => onSelect(notebook.id)}
        className={cn(
          "flex items-center text-gray-400 p-1 rounded cursor-pointer group transition-all mx-1 hover:bg-[#2A2A2A]",
          isSelected && "bg-[#2A2A2A] text-white",
          isOver && isNoteDragging && "bg-[#1F2B1F] text-white"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {dragIndicator === "before" && (
          <div
            className="absolute -top-0.5 h-0.5 bg-[#00A82D]"
            style={{ left: `${level * 16 + 8}px`, right: "8px" }}
          />
        )}
        {dragIndicator === "after" && (
          <div
            className="absolute -bottom-0.5 h-0.5 bg-[#00A82D]"
            style={{ left: `${level * 16 + 8}px`, right: "8px" }}
          />
        )}
        {dragIndicator === "inside" && (
          <div className="absolute inset-0 rounded border border-[#00A82D]" />
        )}
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          {canHaveChildren ? (
            <BookOpen size={18} className={cn("shrink-0 w-[18px]", isSelected ? "text-[#00A82D]" : "text-gray-500")} />
          ) : (
            <Book size={18} className={cn("shrink-0 w-[18px]", isSelected ? "text-[#00A82D]" : "text-gray-500")} />
          )}
          <span className="text-sm truncate font-medium">{notebook.name}</span>
          <span className="text-xs text-gray-500 font-medium">{noteCount ?? 0}</span>
        </div>
        
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
          {canHaveChildren && (
            <button onClick={(e) => { e.stopPropagation(); onAddSub(notebook.id); }} title="Add notebook" className="p-1 hover:text-white">
              <Plus size={14} />
            </button>
          )}
          {canHaveChildren && (
            <button onClick={(e) => { e.stopPropagation(); onToggle(notebook.id); }} title="Expand/Collapse" className="p-1 hover:text-white">
              <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(notebook.id); }} title="Delete notebook" className="p-1 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [notesListView, setNotesListView] = useState<NotesListView>("detailed");
  
  // UI State
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<number>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [listWidth, setListWidth] = useState(350);
  const [searchTerm, setSearchTerm] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeDragNoteId, setActiveDragNoteId] = useState<number | null>(null);
  const [activeDragNotebookId, setActiveDragNotebookId] = useState<number | null>(null);
  const [dragNotebookOver, setDragNotebookOver] = useState<{ id: number; position: "before" | "after" | "inside" | "root" } | null>(null);

  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);
  const notesRef = useRef<Note[]>([]);
  const { show } = useContextMenu({ id: NOTE_CONTEXT_MENU_ID });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const expandTimersRef = useRef<Map<number, number>>(new Map());

  const applySettings = useCallback((p: any) => {
    if (!p || typeof p !== "object") return;
    if (p.sidebarWidth) setSidebarWidth(p.sidebarWidth);
    if (p.listWidth) setListWidth(p.listWidth);
    if (p.selectedNotebookId !== undefined) setSelectedNotebookId(p.selectedNotebookId);
    if (p.selectedNoteId !== undefined) setSelectedNoteId(p.selectedNoteId);
    if (p.expandedNotebooks) setExpandedNotebooks(new Set(p.expandedNotebooks));
    if (p.notesListView === "compact" || p.notesListView === "detailed") setNotesListView(p.notesListView);
  }, []);

  // Load persistence
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = await invoke<any>("get_settings");
        if (stored) {
          applySettings(stored);
        } else {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            try {
              const p = JSON.parse(saved);
              applySettings(p);
              await invoke("set_settings", { settings: p });
              localStorage.removeItem(STORAGE_KEY);
            } catch (e) {}
          }
        }
      } catch (e) {}
      setIsLoaded(true);
    };
    loadSettings();
  }, [applySettings]);

  // Save persistence
  useEffect(() => {
    if (!isLoaded) return;
    const payload = {
      sidebarWidth,
      listWidth,
      selectedNotebookId,
      selectedNoteId,
      expandedNotebooks: Array.from(expandedNotebooks),
      notesListView,
    };
    invoke("set_settings", { settings: payload }).catch(() => {});
  }, [sidebarWidth, listWidth, selectedNotebookId, selectedNoteId, expandedNotebooks, notesListView, isLoaded]);

  useEffect(() => {
    const unlisten = listen<string>("notes-list-view", (event) => {
      if (event.payload === "compact" || event.payload === "detailed") {
        setNotesListView(event.payload);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen("import-evernote", async () => {
      const selected = await open({
        title: "Import from Evernote",
        filters: [{ name: "Evernote Export", extensions: ["enex"] }],
      });
      if (selected) {
        console.log("Evernote import file selected:", selected);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    invoke("set_notes_list_view", { view: notesListView }).catch(() => {});
  }, [notesListView, isLoaded]);

  const fetchData = useCallback(async () => {
    try {
      const [nbs, filteredNotes, allNotesList] = await Promise.all([
        invoke<Notebook[]>("get_notebooks"),
        invoke<Note[]>("get_notes", { notebookId: selectedNotebookId }),
        invoke<Note[]>("get_notes", { notebookId: null }),
      ]);
      setNotebooks(nbs);
      setNotes(filteredNotes);
      setAllNotes(allNotesList);
    } catch (err) { console.error("Fetch Error:", err); }
  }, [selectedNotebookId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) { setTitle(note.title); setContent(note.content); }
  }, [selectedNoteId, notes]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const getOrderedChildren = useCallback((parentId: number | null) => {
    const typeFilter = parentId === null ? "stack" : "notebook";
    return notebooks
      .filter(nb => nb.parentId === parentId && nb.notebookType === typeFilter)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
  }, [notebooks]);

  const notebookNoteCounts = useMemo(() => {
    const notebookCounts = new Map<number, number>();
    for (const note of allNotes) {
      if (note.notebookId === null) continue;
      notebookCounts.set(note.notebookId, (notebookCounts.get(note.notebookId) ?? 0) + 1);
    }
    const stackCounts = new Map<number, number>();
    for (const nb of notebooks) {
      if (nb.notebookType === "stack") stackCounts.set(nb.id, 0);
    }
    for (const nb of notebooks) {
      if (nb.notebookType !== "notebook" || nb.parentId === null) continue;
      const count = notebookCounts.get(nb.id) ?? 0;
      stackCounts.set(nb.parentId, (stackCounts.get(nb.parentId) ?? 0) + count);
    }
    return { notebookCounts, stackCounts };
  }, [allNotes, notebooks]);

  const isDescendant = useCallback((candidateParentId: number | null, notebookId: number) => {
    if (candidateParentId === null) return false;
    const parentMap = new Map<number, number | null>();
    notebooks.forEach(nb => parentMap.set(nb.id, nb.parentId));
    let current = candidateParentId;
    while (current !== null) {
      if (current === notebookId) return true;
      current = parentMap.get(current) ?? null;
    }
    return false;
  }, [notebooks]);

  // Resize logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar.current) setSidebarWidth(Math.max(150, Math.min(450, e.clientX)));
      else if (isResizingList.current) setListWidth(Math.max(200, Math.min(600, e.clientX - sidebarWidth)));
    };
    const handleMouseUp = () => { isResizingSidebar.current = false; isResizingList.current = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [sidebarWidth]);

  // Autosave
  useEffect(() => {
    if (!selectedNoteId) return;
    const timeout = setTimeout(async () => {
      const currentNote = notesRef.current.find(n => n.id === selectedNoteId);
      if (currentNote && (title !== currentNote.title || content !== currentNote.content)) {
        await invoke("upsert_note", { id: selectedNoteId, title, content, notebookId: currentNote.notebookId });
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title, content, updatedAt: Date.now()/1000 } : n));
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, selectedNoteId]);

  const createNote = async () => {
    try {
      const id = await invoke<number>("upsert_note", { id: null, title: "New Note", content: "", notebookId: selectedNotebookId });
      await fetchData();
      setSelectedNoteId(id);
    } catch (err) {}
  };

  const deleteNote = async (id: number) => {
    if (await ask("Delete note?", { title: "Confirm Deletion", type: "warning" })) {
      await invoke("delete_note", { id });
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchData();
    }
  };

  const createNotebook = async (parentId: number | null = null) => {
    const name = window.prompt("Notebook name:");
    if (name) {
      await invoke("create_notebook", { name, parentId });
      fetchData();
    }
  };

  const deleteNotebook = async (id: number) => {
    if (await ask("Delete notebook and its sub-notebooks?", { title: "Confirm Deletion", type: "warning" })) {
      await invoke("delete_notebook", { id });
      if (selectedNotebookId === id) setSelectedNotebookId(null);
      fetchData();
    }
  };

  const moveNoteToNotebook = useCallback(async (noteId: number, notebookId: number | null) => {
    await invoke("move_note", { noteId, notebookId });
    if (selectedNotebookId !== null && notebookId !== selectedNotebookId) {
      if (selectedNoteId === noteId) setSelectedNoteId(null);
    }
    fetchData();
  }, [fetchData, selectedNotebookId, selectedNoteId]);

  const handleDragStart = useCallback((event: any) => {
    const activeData = event?.active?.data?.current;
    if (activeData?.type === "note" && activeData.noteId) {
      setActiveDragNoteId(activeData.noteId);
    }
    if (activeData?.type === "notebook" && activeData.notebookId) {
      setActiveDragNotebookId(activeData.notebookId);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragNoteId(null);
    setActiveDragNotebookId(null);
    setDragNotebookOver(null);
  }, []);

  const handleDragOver = useCallback((event: any) => {
    const activeData = event?.active?.data?.current;
    const overId = event?.over?.id;
    const overTarget = event?.over?.data?.current;

    if (activeData?.type === "notebook") {
      const activeType = activeData.notebookType as "stack" | "notebook";
      if (overTarget?.dropType === "root") {
        if (activeType === "stack") {
          setDragNotebookOver(null);
        } else {
          setDragNotebookOver(null);
        }
      } else if (overTarget?.dropType === "notebook") {
        const overNotebookId = overTarget.notebookId;
        const overNotebook = notebooks.find(nb => nb.id === overNotebookId);
        if (!overNotebook) return;
        const activeRect = event?.active?.rect?.current?.translated ?? event?.active?.rect?.current?.initial;
        const overRect = event?.over?.rect;
        if (overRect && activeRect) {
          const activeMid = activeRect.top + activeRect.height / 2;
          const topThreshold = overRect.top + overRect.height * 0.33;
          const bottomThreshold = overRect.top + overRect.height * 0.66;
          let position: "before" | "after" | "inside" = "inside";
          if (activeMid < topThreshold) position = "before";
          else if (activeMid > bottomThreshold) position = "after";
          if (activeType === "stack") {
            if (overNotebook.notebookType !== "stack") return;
            setDragNotebookOver({ id: overNotebookId, position: position === "inside" ? "after" : position });
            return;
          }
          if (overNotebook.notebookType === "stack") {
            setDragNotebookOver({ id: overNotebookId, position: "inside" });
            return;
          }
          setDragNotebookOver({ id: overNotebookId, position: position === "inside" ? "after" : position });
        }
      } else {
        setDragNotebookOver(null);
      }
    } else {
      setDragNotebookOver(null);
    }

    if (typeof overId !== "string" || !overId.startsWith("notebook-")) return;
    const notebookId = Number(overId.replace("notebook-", ""));
    if (!Number.isFinite(notebookId)) return;
    const targetNotebook = notebooks.find(nb => nb.id === notebookId);
    if (!targetNotebook || targetNotebook.notebookType !== "stack") return;
    if (expandedNotebooks.has(notebookId)) return;
    if (expandTimersRef.current.has(notebookId)) return;
    const timer = window.setTimeout(() => {
      setExpandedNotebooks(prev => {
        if (prev.has(notebookId)) return prev;
        const next = new Set(prev);
        next.add(notebookId);
        return next;
      });
      expandTimersRef.current.delete(notebookId);
    }, 350);
    expandTimersRef.current.set(notebookId, timer);
  }, [expandedNotebooks, notebooks]);

  const handleDragEnd = useCallback(async (event: any) => {
    const activeData = event?.active?.data?.current;
    const overTarget = event?.over?.data?.current;
    setActiveDragNoteId(null);
    setActiveDragNotebookId(null);
    setDragNotebookOver(null);
    expandTimersRef.current.forEach(timer => window.clearTimeout(timer));
    expandTimersRef.current.clear();
    if (!activeData || !overTarget) return;
    if (activeData.type === "note") {
      if (overTarget.dropType !== "notebook" && overTarget.dropType !== "all-notes") return;
      const noteId = activeData.noteId;
      if (!noteId) return;
      const notebookId = overTarget.notebookId ?? null;
      const currentNote = notesRef.current.find(n => n.id === noteId);
      if (!currentNote) return;
      if (currentNote.notebookId === notebookId) return;
      await moveNoteToNotebook(noteId, notebookId);
      return;
    }
    if (activeData.type === "notebook") {
      const notebookId = activeData.notebookId;
      const notebookType = activeData.notebookType as "stack" | "notebook";
      if (!notebookId) return;
      if (overTarget.dropType === "root") {
        if (notebookType !== "stack") return;
        const targetParentId = null;
        if (isDescendant(targetParentId, notebookId)) return;
        const siblings = getOrderedChildren(null).filter(nb => nb.id !== notebookId);
        const targetIndex = siblings.length;
        await invoke("move_notebook", { notebookId, parentId: targetParentId, index: targetIndex });
        fetchData();
        return;
      }
      if (overTarget.dropType !== "notebook" || overTarget.notebookId === null) return;
      if (overTarget.notebookId === notebookId) return;
      const overNotebook = notebooks.find(nb => nb.id === overTarget.notebookId);
      const activeNotebook = notebooks.find(nb => nb.id === notebookId);
      if (!overNotebook || !activeNotebook) return;
      if (notebookType === "stack" && overNotebook.notebookType !== "stack") return;
      const activeRect = event?.active?.rect?.current?.translated ?? event?.active?.rect?.current?.initial;
      const overRect = event?.over?.rect;
      if (!overRect || !activeRect) return;
      const activeMid = activeRect.top + activeRect.height / 2;
      const topThreshold = overRect.top + overRect.height * 0.33;
      const bottomThreshold = overRect.top + overRect.height * 0.66;
      let position: "before" | "after" | "inside" = "inside";
      if (activeMid < topThreshold) position = "before";
      else if (activeMid > bottomThreshold) position = "after";
      if (notebookType === "stack" && position === "inside") {
        position = "after";
      }
      if (notebookType === "notebook" && overNotebook.notebookType === "stack") {
        position = "inside";
      } else if (notebookType === "notebook" && overNotebook.notebookType !== "stack" && position === "inside") {
        position = "after";
      }
      const targetParentId = position === "inside" ? overNotebook.id : overNotebook.parentId;
      if (notebookType === "stack" && targetParentId !== null) return;
      const targetParent = targetParentId === null ? null : notebooks.find(nb => nb.id === targetParentId);
      if (notebookType === "notebook") {
        if (targetParentId === null) return;
        if (!targetParent || targetParent.notebookType !== "stack") return;
      }
      if (isDescendant(targetParentId, notebookId)) return;
      const siblings = getOrderedChildren(targetParentId).filter(nb => nb.id !== notebookId);
      let targetIndex = siblings.findIndex(nb => nb.id === overNotebook.id);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after") targetIndex += 1;
      if (position === "inside") targetIndex = siblings.length;
      await invoke("move_notebook", { notebookId, parentId: targetParentId, index: targetIndex });
      fetchData();
    }
  }, [fetchData, getOrderedChildren, isDescendant, moveNoteToNotebook, notebooks]);

  const handleNoteContextMenu = (event: React.MouseEvent, noteId: number) => {
    event.preventDefault();
    show({ event, props: { noteId } });
  };

  const renderNotebookMenuNode = (nb: Notebook) => {
    const children = getOrderedChildren(nb.id);
    if (children.length > 0) {
      return (
        <Submenu key={nb.id} label={nb.name}>
          <Item onClick={({ props }) => { if (props?.noteId) moveNoteToNotebook(props.noteId, nb.id); }}>Move here</Item>
          {children.map(child => renderNotebookMenuNode(child))}
        </Submenu>
      );
    }
    return (
      <Item key={nb.id} onClick={({ props }) => { if (props?.noteId) moveNoteToNotebook(props.noteId, nb.id); }}>
        {nb.name}
      </Item>
    );
  };

  const AllNotesDropTarget = ({ isNoteDragging, noteCount }: { isNoteDragging: boolean; noteCount: number }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: "notebook-null",
      data: { notebookId: null, dropType: "all-notes" },
    });

    return (
      <div
        ref={setNodeRef}
        onClick={() => setSelectedNotebookId(null)}
        className={cn(
          "flex items-center gap-3 text-gray-400 p-2 rounded cursor-pointer mx-1 transition-all",
          selectedNotebookId === null && "bg-[#2A2A2A] text-white",
          isOver && isNoteDragging && "bg-[#1F2B1F] text-white"
        )}
        style={{ paddingLeft: "8px" }}
      >
        <FileText size={18} className={cn("shrink-0", selectedNotebookId === null ? "text-[#00A82D]" : "text-gray-500")} />
        <span className="text-sm font-medium">All Notes</span>
        <span className="text-xs text-gray-500 font-medium">{noteCount}</span>
      </div>
    );
  };

  const NotebookRootDropTarget = ({ children }: { children: React.ReactNode }) => {
    const { setNodeRef } = useDroppable({
      id: "notebook-root",
      data: { dropType: "root", notebookId: null },
    });
    return (
      <div ref={setNodeRef} className="rounded relative">
        {children}
      </div>
    );
  };

  const renderNoteCard = (note: Note, isOverlay: boolean, isDragging: boolean) => {
    if (notesListView === "compact") {
      return (
        <div
          className={cn(
            "px-6 py-3 border-b border-gray-100 cursor-pointer relative bg-white",
            !isOverlay && "group hover:bg-[#F8F8F8]",
            selectedNoteId === note.id && !isOverlay && "bg-[#F2F2F2]"
          )}
        >
          <div className="flex items-center justify-between text-black">
            <h3 className={cn("font-normal text-sm truncate pr-4", selectedNoteId === note.id && !isOverlay && "text-[#00A82D]")}>
              {note.title || "Untitled"}
            </h3>
            <div className="text-[10px] text-gray-400 uppercase font-medium shrink-0">
              {new Date(note.updatedAt * 1000).toLocaleDateString()}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "px-6 py-5 border-b border-gray-100 cursor-pointer relative bg-white",
          !isOverlay && "group hover:bg-[#F8F8F8]",
          selectedNoteId === note.id && !isOverlay && "ring-1 ring-[#00A82D] z-10",
          isDragging && "py-3"
        )}
      >
        <div className="flex justify-between items-start mb-1 text-black">
          <h3 className={cn("font-semibold text-sm truncate pr-4", selectedNoteId === note.id && !isOverlay && "text-[#00A82D]")}>{note.title || "Untitled"}</h3>
          {!isOverlay && !isDragging && (
            <button onMouseDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {!isDragging && (
          <>
            <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">{note.content.replace(/<[^>]*>/g, '') || "No text"}</p>
            <div className="text-[10px] text-gray-400 uppercase font-medium">{new Date(note.updatedAt * 1000).toLocaleDateString()}</div>
          </>
        )}
      </div>
    );
  };

  const renderDragPreview = (note: Note) => (
    <div className="px-4 py-2 bg-white border border-gray-200 rounded shadow-sm text-sm text-black opacity-70">
      {note.title || "Untitled"}
    </div>
  );

  const NoteRow = ({ note }: { note: Note }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `note-${note.id}`,
      data: { type: "note", noteId: note.id },
    });
    const style = { transform: CSS.Translate.toString(transform), touchAction: "none" as const };

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onContextMenu={(event) => handleNoteContextMenu(event, note.id)}
        onClick={() => setSelectedNoteId(note.id)}
        className={cn(
          "relative",
          isDragging && "opacity-30"
        )}
      >
        {renderNoteCard(note, false, isDragging)}
      </div>
    );
  };

  const renderNotebookRecursive = (nb: Notebook, level: number = 0) => {
    const children = getOrderedChildren(nb.id);
    const isExpanded = expandedNotebooks.has(nb.id);
    const canHaveChildren = nb.notebookType === "stack";
    const noteCount = nb.notebookType === "stack"
      ? (notebookNoteCounts.stackCounts.get(nb.id) ?? 0)
      : (notebookNoteCounts.notebookCounts.get(nb.id) ?? 0);
    return (
      <div key={nb.id}>
        <NotebookItem 
          notebook={nb} isSelected={selectedNotebookId === nb.id} level={level}
          noteCount={noteCount}
          onSelect={setSelectedNotebookId}
          onAddSub={createNotebook}
          onDelete={deleteNotebook}
          isExpanded={isExpanded}
          isNoteDragging={activeDragNoteId !== null}
          dragIndicator={dragNotebookOver?.id === nb.id ? dragNotebookOver.position : null}
          onToggle={(id: number) => setExpandedNotebooks(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })}
        />
        {canHaveChildren && isExpanded && children.map(c => renderNotebookRecursive(c, level + 1))}
      </div>
    );
  };

  if (!isLoaded) return <div className="h-screen w-full bg-[#1A1A1A]" />;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none">
      {/* Sidebar */}
      <div style={{ width: sidebarWidth }} className="bg-[#1A1A1A] flex flex-col shrink-0 relative">
        <div className="p-4 flex flex-col h-full text-white">
          <div className="flex items-center gap-2 mb-6 px-2 shrink-0">
            <div className="w-8 h-8 bg-[#00A82D] rounded-full flex items-center justify-center font-bold text-xs uppercase">M</div>
            <span className="font-semibold text-sm truncate uppercase tracking-widest">Notes Classic</span>
          </div>
          
          <button 
            onClick={createNote}
            className="w-fit bg-[#00A82D] hover:bg-[#008f26] text-white flex items-center gap-2 py-2 px-6 rounded-full transition-colors text-sm font-medium mb-8 ml-2 shadow-lg shrink-0"
          >
            <Plus size={20} strokeWidth={3} /><span>New Note</span>
          </button>
          
          <nav className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <AllNotesDropTarget isNoteDragging={activeDragNoteId !== null} noteCount={allNotes.length} />
            
            <div className="mt-4 pt-4 pb-2 px-3 flex justify-between items-center text-gray-500 uppercase text-[10px] font-bold tracking-widest shrink-0">
              <span>Notebooks</span>
              <FolderPlus size={16} title="Create notebook" className="cursor-pointer hover:text-white transition-colors" onClick={() => createNotebook(null)} />
            </div>
            
            <NotebookRootDropTarget>
              {getOrderedChildren(null).map(nb => renderNotebookRecursive(nb))}
            </NotebookRootDropTarget>
          </nav>
        </div>
        <div onMouseDown={() => { isResizingSidebar.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
      </div>

      {/* List */}
      <div style={{ width: listWidth }} className="border-r border-gray-200 bg-white flex flex-col shrink-0 relative text-black">
        <div className="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8] shrink-0">
          <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-4 italic truncate">
            {selectedNotebookId ? notebooks.find(n => n.id === selectedNotebookId)?.name : "All Notes"}
          </h2>
          <div className="relative text-black">
            <Search className="absolute left-3 top-2 text-gray-400" size={14} />
            <input 
              type="text" placeholder="Search..." 
              className="w-full bg-white border border-gray-200 rounded py-1.5 pl-9 pr-4 text-sm outline-none focus:border-[#00A82D]" 
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} 
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.filter(n => n.title.toLowerCase().includes(searchTerm.toLowerCase())).map(note => (
            <NoteRow key={note.id} note={note} />
          ))}
        </div>
        <div onMouseDown={() => { isResizingList.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden text-black">
        {selectedNoteId ? (
          <div className="flex flex-col h-full">
            <div className="px-10 py-6 shrink-0 bg-white shadow-sm z-10">
              <input className="w-full text-4xl font-light border-none focus:ring-0 outline-none" value={title} placeholder="Title" onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="flex-1 overflow-hidden">
              <Editor content={content} onChange={setContent} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <FileText size={80} strokeWidth={1} className="mb-6 text-gray-100" />
            <p className="text-lg font-light">Select a note</p>
          </div>
        )}
      </div>
      <Menu id={NOTE_CONTEXT_MENU_ID}>
        <Item onClick={({ props }) => { if (props?.noteId) deleteNote(props.noteId); }}>
          Delete Note
        </Item>
        <Separator />
        <Submenu label="Move To">
          <Item onClick={({ props }) => { if (props?.noteId) moveNoteToNotebook(props.noteId, null); }}>
            All Notes
          </Item>
          {getOrderedChildren(null).map(nb => renderNotebookMenuNode(nb))}
        </Submenu>
      </Menu>
      <DragOverlay>
        {activeDragNoteId
          ? (() => {
              const note = notesRef.current.find(n => n.id === activeDragNoteId);
              return note ? renderDragPreview(note) : null;
            })()
          : activeDragNotebookId
            ? (() => {
                const notebook = notebooks.find(nb => nb.id === activeDragNotebookId);
                return notebook ? (
                  <div className="px-4 py-2 bg-[#1A1A1A] text-white border border-[#2A2A2A] rounded shadow-sm text-sm opacity-70">
                    {notebook.name}
                  </div>
                ) : null;
              })()
            : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}

export default App;
