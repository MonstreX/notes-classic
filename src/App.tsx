import React, { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/dialog";
import { Plus, FileText } from "lucide-react";
import { openNoteContextMenu, type ContextMenuNode } from "./vanilla/contextMenu";
import Editor from "./components/Editor";
import { mountSidebar, type SidebarHandlers, type SidebarState, type SidebarInstance } from "./vanilla/sidebar";
import { mountNotesList, type NotesListHandlers, type NotesListState, type NotesListInstance } from "./vanilla/notesList";
import { openNotebookDialog, openConfirmDialog } from "./vanilla/dialogs";

interface Notebook {
  id: number;
  name: string;
  parentId: number | null;
  notebookType: "stack" | "notebook";
  sortOrder: number;
  externalId?: string | null;
}
interface NoteListItem {
  id: number;
  title: string;
  content: string;
  updatedAt: number;
  notebookId: number | null;
}
interface NoteDetail {
  id: number;
  title: string;
  content: string;
  updatedAt: number;
  notebookId: number | null;
  externalId?: string | null;
  meta?: string | null;
  contentHash?: string | null;
  contentSize?: number | null;
}
interface NoteCounts {
  total: number;
  perNotebook: { notebookId: number; count: number }[];
}
type NotesListView = "detailed" | "compact";

const STORAGE_KEY = "notes_classic_v10_stable";

const VanillaSidebarHost = React.memo(function VanillaSidebarHost({ state, handlers }: { state: SidebarState; handlers: SidebarHandlers }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<SidebarInstance | null>(null);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    if (!instanceRef.current) {
      instanceRef.current = mountSidebar(rootRef.current, handlers);
    }
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [handlers]);

  useLayoutEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.update(state);
  }, [state]);

  return <div ref={rootRef} className="flex-1 min-h-0 overflow-hidden" />;
});

const VanillaNotesListHost = React.memo(function VanillaNotesListHost({ state, handlers }: { state: NotesListState; handlers: NotesListHandlers }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<NotesListInstance | null>(null);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    if (!instanceRef.current) {
      instanceRef.current = mountNotesList(rootRef.current, handlers);
    }
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [handlers]);

  useLayoutEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.update(state);
  }, [state]);

  return <div ref={rootRef} className="flex-1 min-h-0 overflow-hidden" />;
});

function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [noteCounts, setNoteCounts] = useState<Map<number, number>>(new Map());
  const [totalNotes, setTotalNotes] = useState(0);
  const [notesListView, setNotesListView] = useState<NotesListView>("detailed");
  const imageSrcMapRef = useRef<Map<string, string>>(new Map());
  const dataFileCacheRef = useRef<Map<string, string>>(new Map());
  
  // UI State
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<number>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [listWidth, setListWidth] = useState(350);
  const [searchTerm, setSearchTerm] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [activeNote, setActiveNote] = useState<NoteDetail | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);
  const sidebarHandlersRef = useRef<SidebarHandlers | null>(null);
  const notesListHandlersRef = useRef<NotesListHandlers | null>(null);
  const activeNoteRef = useRef<NoteDetail | null>(null);

  const applySettings = useCallback((p: any) => {
    if (!p || typeof p !== "object") return;
    if (p.sidebarWidth) setSidebarWidth(p.sidebarWidth);
    if (p.listWidth) setListWidth(p.listWidth);
    if (p.selectedNotebookId !== undefined) {
      if (p.selectedNotebookId === null) {
        setSelectedNotebookId(null);
      } else {
        const parsed = Number(p.selectedNotebookId);
        setSelectedNotebookId(Number.isFinite(parsed) ? parsed : null);
      }
    }
    if (p.selectedNoteId !== undefined) {
      if (p.selectedNoteId === null) {
        setSelectedNoteId(null);
      } else {
        const parsed = Number(p.selectedNoteId);
        setSelectedNoteId(Number.isFinite(parsed) ? parsed : null);
      }
    }
    if (p.expandedNotebooks) {
      const ids = Array.isArray(p.expandedNotebooks)
        ? p.expandedNotebooks.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
        : [];
      setExpandedNotebooks(new Set(ids));
    }
    if (p.notesListView === "compact" || p.notesListView === "detailed") setNotesListView(p.notesListView);
  }, []);

  const normalizeEnmlContent = useCallback((raw: string) => {
    if (!raw) return raw;
    let out = raw.replace(/<en-note[^>]*>/gi, "<div>");
    out = out.replace(/<\/en-note>/gi, "</div>");
    out = out.replace(/<br><\/br>/gi, "<br>");
    return out;
  }, []);


  const ensureNotesScheme = useCallback((raw: string) => {
    if (!raw) return raw;
    if (raw.includes("notes-file://")) return raw;
    return raw
      .replace(/src=\"files\//g, 'src="notes-file://files/')
      .replace(/src='files\//g, "src='notes-file://files/");
  }, []);

  const toDisplayContent = useCallback(async (raw: string) => {
    if (!raw) return raw;
    const matches = Array.from(raw.matchAll(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g));
    if (matches.length === 0) return raw;

    const uniqueRel = Array.from(new Set(matches.map(m => m[2])));
    const resolved = new Map<string, string>();
    await Promise.all(uniqueRel.map(async (rel) => {
      const cached = dataFileCacheRef.current.get(rel);
      if (cached) {
        resolved.set(rel, cached);
        return;
      }
      try {
        const dataUrl = await invoke<string>("read_data_file", { path: `files/${rel}` });
        resolved.set(rel, dataUrl);
        dataFileCacheRef.current.set(rel, dataUrl);
        imageSrcMapRef.current.set(dataUrl, `notes-file://files/${rel}`);
      } catch (e) {}
    }));

    return raw.replace(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, rel) => {
      const dataUrl = resolved.get(rel);
      if (!dataUrl) return match;
      return `src=${quote}${dataUrl}${quote}`;
    });
  }, []);

  const toStorageContent = useCallback((raw: string) => {
    if (!raw) return raw;
    const normalized = raw.replace(/src=(\"|')(asset|tauri):\/\/[^\"']*?\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, _scheme, rel) => {
      return `src=${quote}notes-file://files/${rel}${quote}`;
    });
    return normalized.replace(/src=(\"|')(data:[^\"']+)\1/g, (match, quote, dataUrl) => {
      const original = imageSrcMapRef.current.get(dataUrl);
      if (!original) return match;
      return `src=${quote}${original}${quote}`;
    });
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
    if (!isLoaded) return;
    try {
      const [nbs, filteredNotes, counts] = await Promise.all([
        invoke<Notebook[]>("get_notebooks"),
        invoke<NoteListItem[]>("get_notes", { notebookId: selectedNotebookId }),
        invoke<NoteCounts>("get_note_counts"),
      ]);
      setNotebooks(nbs);
      setNotes(filteredNotes);
      const map = new Map<number, number>();
      counts.perNotebook.forEach(item => {
        map.set(item.notebookId, item.count);
      });
      setNoteCounts(map);
      setTotalNotes(counts.total);
    } catch (err) { console.error("Fetch Error:", err); }
  }, [selectedNotebookId, isLoaded]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!selectedNoteId) {
      setActiveNote(null);
      setTitle("");
      setContent("");
      return;
    }
    invoke<NoteDetail | null>("get_note", { id: selectedNoteId })
      .then((note) => {
        if (!note) {
          setActiveNote(null);
          setTitle("");
          setContent("");
          return;
        }
        const normalized = ensureNotesScheme(normalizeEnmlContent(note.content));
        toDisplayContent(normalized).then((displayContent) => {
          if (displayContent !== note.content) {
            note = { ...note, content: displayContent };
          }
          setActiveNote(note);
          setTitle(note.title);
          setContent(note.content);
        }).catch(() => {
          setActiveNote(note);
          setTitle(note.title);
          setContent(note.content);
        });
      })
      .catch(() => {});
  }, [selectedNoteId, ensureNotesScheme, normalizeEnmlContent, toDisplayContent]);

  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  const getOrderedChildren = useCallback((parentId: number | null) => {
    const typeFilter = parentId === null ? "stack" : "notebook";
    return notebooks
      .filter(nb => nb.parentId === parentId && nb.notebookType === typeFilter)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
  }, [notebooks]);

  const notebookNoteCounts = useMemo(() => {
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
  }, [noteCounts, notebooks]);

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

  const buildMenuNodes = useCallback((parentId: number | null): ContextMenuNode[] => {
    return getOrderedChildren(parentId).map((nb) => ({
      id: nb.id,
      name: nb.name,
      type: nb.notebookType,
      children: nb.notebookType === "stack" ? buildMenuNodes(nb.id) : [],
    }));
  }, [getOrderedChildren]);

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
      const currentNote = activeNoteRef.current;
      if (!currentNote || currentNote.id !== selectedNoteId) return;
      if (title !== currentNote.title || content !== currentNote.content) {
        const storageContent = toStorageContent(content);
        await invoke("upsert_note", { id: selectedNoteId, title, content: storageContent, notebookId: currentNote.notebookId });
        setActiveNote(prev => prev ? { ...prev, title, content, updatedAt: Date.now() / 1000 } : prev);
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title, content, updatedAt: Date.now() / 1000 } : n));
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, selectedNoteId, toStorageContent]);

  const createNote = async () => {
    try {
      const id = await invoke<number>("upsert_note", { id: null, title: "New Note", content: "", notebookId: selectedNotebookId });
      await fetchData();
      setSelectedNoteId(id);
    } catch (err) {}
  };

  const deleteNote = async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete note",
      message: "Are you sure you want to delete this note?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await invoke("delete_note", { id });
    if (selectedNoteId === id) setSelectedNoteId(null);
    fetchData();
  };

  const createNotebook = async (parentId: number | null = null) => {
    const name = await openNotebookDialog({ parentId });
    if (!name) return;
    await invoke("create_notebook", { name, parentId });
    fetchData();
  };

  const deleteNotebook = async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete notebook",
      message: "Delete this notebook and its sub-notebooks?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await invoke("delete_notebook", { id });
    if (selectedNotebookId === id) setSelectedNotebookId(null);
    fetchData();
  };

  const moveNoteToNotebook = useCallback(async (noteId: number, notebookId: number | null) => {
    await invoke("move_note", { noteId, notebookId });
    if (selectedNotebookId !== null && notebookId !== selectedNotebookId) {
      if (selectedNoteId === noteId) setSelectedNoteId(null);
    }
    fetchData();
  }, [fetchData, selectedNotebookId, selectedNoteId]);


  const moveNotebookByDrag = useCallback(async (activeId: number, overId: number, position: "before" | "after" | "inside") => {
    const activeNotebook = notebooks.find(nb => nb.id === activeId);
    const overNotebook = notebooks.find(nb => nb.id === overId);
    if (!activeNotebook || !overNotebook) return;
    const activeType = activeNotebook.notebookType;
    const overType = overNotebook.notebookType;

    if (activeType === "stack") {
      if (overType !== "stack") return;
      const targetParentId = null;
      const siblings = getOrderedChildren(null).filter(nb => nb.id !== activeId);
      let targetIndex = siblings.findIndex(nb => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after") targetIndex += 1;
      if (position === "inside") targetIndex += 1;
      if (isDescendant(targetParentId, activeId)) return;
      await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
      fetchData();
      return;
    }

    if (activeType === "notebook") {
      let targetParentId: number | null = null;
      if (overType === "stack") {
        if (position !== "inside") return;
        targetParentId = overNotebook.id;
        const siblings = getOrderedChildren(targetParentId).filter(nb => nb.id !== activeId);
        const targetIndex = siblings.length;
        if (isDescendant(targetParentId, activeId)) return;
        await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
        fetchData();
        return;
      }

      targetParentId = overNotebook.parentId;
      if (targetParentId === null) return;
      const targetParent = notebooks.find(nb => nb.id === targetParentId);
      if (!targetParent || targetParent.notebookType !== "stack") return;
      const siblings = getOrderedChildren(targetParentId).filter(nb => nb.id !== activeId);
      let targetIndex = siblings.findIndex(nb => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after") targetIndex += 1;
      if (position === "inside") targetIndex += 1;
      if (isDescendant(targetParentId, activeId)) return;
      await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
      fetchData();
    }
  }, [fetchData, getOrderedChildren, isDescendant, notebooks]);

  sidebarHandlersRef.current = {
    onSelectNotebook: (id) => setSelectedNotebookId(id),
    onSelectAll: () => setSelectedNotebookId(null),
    onToggleNotebook: (id) => setExpandedNotebooks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }),
    onCreateNotebook: (parentId) => { createNotebook(parentId); },
    onDeleteNotebook: (id) => { deleteNotebook(id); },
    onMoveNotebook: (activeId, overId, position) => { moveNotebookByDrag(activeId, overId, position); },
  };

  notesListHandlersRef.current = {
    onSelectNote: (id) => setSelectedNoteId(id),
    onDeleteNote: (id) => { deleteNote(id); },
    onSearchChange: (value) => setSearchTerm(value),
    onNoteContextMenu: (event, id) => {
      event.preventDefault();
      const nodes = buildMenuNodes(null);
      openNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: id,
        nodes,
        onDelete: deleteNote,
        onMove: moveNoteToNotebook,
      });
    },
    onMoveNote: (noteId, notebookId) => { moveNoteToNotebook(noteId, notebookId); },
  };

  const stableSidebarHandlers = useMemo<SidebarHandlers>(() => ({
    onSelectNotebook: (id) => { sidebarHandlersRef.current?.onSelectNotebook(id); },
    onSelectAll: () => { sidebarHandlersRef.current?.onSelectAll(); },
    onToggleNotebook: (id) => { sidebarHandlersRef.current?.onToggleNotebook(id); },
    onCreateNotebook: (parentId) => { sidebarHandlersRef.current?.onCreateNotebook(parentId); },
    onDeleteNotebook: (id) => { sidebarHandlersRef.current?.onDeleteNotebook(id); },
    onMoveNotebook: (activeId, overId, position) => { sidebarHandlersRef.current?.onMoveNotebook(activeId, overId, position); },
  }), []);

  const stableNotesListHandlers = useMemo<NotesListHandlers>(() => ({
    onSelectNote: (id) => { notesListHandlersRef.current?.onSelectNote(id); },
    onDeleteNote: (id) => { notesListHandlersRef.current?.onDeleteNote(id); },
    onSearchChange: (value) => { notesListHandlersRef.current?.onSearchChange(value); },
    onNoteContextMenu: (event, id) => { notesListHandlersRef.current?.onNoteContextMenu(event, id); },
    onMoveNote: (noteId, notebookId) => { notesListHandlersRef.current?.onMoveNote(noteId, notebookId); },
  }), []);

  const sidebarState = useMemo<SidebarState>(() => ({
    notebooks,
    selectedNotebookId,
    expandedNotebooks,
    noteCounts,
    totalNotes,
  }), [notebooks, selectedNotebookId, expandedNotebooks, noteCounts, totalNotes]);

  const notesListState = useMemo<NotesListState>(() => ({
    notes,
    notebooks,
    selectedNotebookId,
    selectedNoteId,
    notesListView,
    searchTerm,
  }), [notes, notebooks, selectedNotebookId, selectedNoteId, notesListView, searchTerm]);

  if (!isLoaded) return <div className="h-screen w-full bg-[#1A1A1A]" />;

  return (
    <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none">
      {/* Sidebar */}
      <div style={{ width: sidebarWidth }} className="bg-[#1A1A1A] flex flex-col shrink-0 relative">
        <div className="p-4 flex flex-col h-full min-h-0 text-white">
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
          
          <VanillaSidebarHost state={sidebarState} handlers={stableSidebarHandlers} />
        </div>
        <div onMouseDown={() => { isResizingSidebar.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
      </div>

      {/* List */}
      <div style={{ width: listWidth }} className="border-r border-gray-200 bg-white flex flex-col shrink-0 relative text-black">
        <VanillaNotesListHost state={notesListState} handlers={stableNotesListHandlers} />
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
    </div>
  );
}

export default App;
