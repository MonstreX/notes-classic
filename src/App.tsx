import React, { useEffect, useCallback, useRef, useMemo, useLayoutEffect, useSyncExternalStore } from "react";
import { Plus, FileText } from "lucide-react";
import { openNoteContextMenu, type ContextMenuNode } from "./vanilla/contextMenu";
import Editor from "./components/Editor";
import { mountSidebar, type SidebarHandlers, type SidebarState, type SidebarInstance } from "./vanilla/sidebar";
import { mountNotesList, type NotesListHandlers, type NotesListState, type NotesListInstance } from "./vanilla/notesList";
import { initApp, actions } from "./vanilla/appController";
import { appStore } from "./vanilla/store";

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
  const state = useSyncExternalStore(appStore.subscribe, appStore.getState);
  const {
    notebooks,
    notes,
    noteCounts,
    totalNotes,
    notesListView,
    selectedNotebookId,
    selectedNoteId,
    expandedNotebooks,
    sidebarWidth,
    listWidth,
    searchTerm,
    title,
    content,
    isLoaded,
  } = state;

  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);
  const sidebarHandlersRef = useRef<SidebarHandlers | null>(null);
  const notesListHandlersRef = useRef<NotesListHandlers | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cleanup: (() => void) | undefined;
    initApp().then((fn) => {
      cleanup = fn;
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const getOrderedChildren = useCallback((parentId: number | null) => {
    const typeFilter = parentId === null ? "stack" : "notebook";
    return notebooks
      .filter(nb => nb.parentId === parentId && nb.notebookType === typeFilter)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
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
      if (isResizingSidebar.current) actions.setSidebarWidth(Math.max(150, Math.min(450, e.clientX)));
      else if (isResizingList.current) actions.setListWidth(Math.max(200, Math.min(600, e.clientX - sidebarWidth)));
    };
    const handleMouseUp = () => { isResizingSidebar.current = false; isResizingList.current = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [sidebarWidth]);

  // Autosave
  sidebarHandlersRef.current = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onCreateNotebook: (parentId) => { actions.createNotebook(parentId); },
    onDeleteNotebook: (id) => { actions.deleteNotebook(id); },
    onMoveNotebook: (activeId, overId, position) => { actions.moveNotebookByDrag(activeId, overId, position); },
  };

  notesListHandlersRef.current = {
    onSelectNote: (id) => actions.selectNote(id),
    onDeleteNote: (id) => { actions.deleteNote(id); },
    onSearchChange: (value) => actions.setSearchTerm(value),
    onNoteContextMenu: (event, id) => {
      event.preventDefault();
      const nodes = buildMenuNodes(null);
      openNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: id,
        nodes,
        onDelete: actions.deleteNote,
        onMove: actions.moveNoteToNotebook,
      });
    },
    onMoveNote: (noteId, notebookId) => { actions.moveNoteToNotebook(noteId, notebookId); },
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
            onClick={actions.createNote}
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
              <input className="w-full text-4xl font-light border-none focus:ring-0 outline-none" value={title} placeholder="Title" onChange={e => actions.setTitle(e.target.value)} />
            </div>
            <div className="flex-1 overflow-hidden">
              <Editor content={content} onChange={actions.setContent} />
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
