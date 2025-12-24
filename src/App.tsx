import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { ask } from "@tauri-apps/api/dialog";
import { Plus, Trash2, Search, FileText, Book, FolderPlus, ChevronRight } from "lucide-react";
import { 
  DndContext, 
  DragOverlay, 
  useDraggable, 
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import Editor from "./components/Editor";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Notebook {
  id: number;
  name: string;
  parent_id: number | null;
}

interface Note {
  id: number;
  title: string;
  content: string;
  updated_at: number;
  notebook_id: number | null;
}

// --- DRAGGABLE COMPONENT ---
function DraggableNote({ note, isSelected, onClick, onDelete, onContextMenu }: { 
  note: Note, isSelected: boolean, onClick: () => void, onDelete: (e: any, id: number) => void, onContextMenu: (e: any, id: number) => void 
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `note-${note.id}`,
    data: { noteId: note.id }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, note.id)}
      className={cn(
        "px-6 py-5 border-b border-gray-100 cursor-pointer group hover:bg-[#F8F8F8] relative bg-white",
        isSelected && "ring-1 ring-[#00A82D] z-10",
        isDragging && "opacity-50 z-50 shadow-2xl"
      )}
    >
      <div className="flex justify-between items-start mb-1 pointer-events-none">
        <h3 className={cn("font-semibold text-sm truncate pr-4 text-[#222]", isSelected && "text-[#00A82D]")}>
          {note.title || "Untitled"}
        </h3>
        <button 
          onMouseDown={(e) => e.stopPropagation()} 
          onClick={(e) => onDelete(e, note.id)}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 pointer-events-auto"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2 pointer-events-none">
        {note.content.replace(/<[^>]*>/g, '') || "No text"}
      </p>
      <div className="text-[10px] text-gray-400 uppercase font-medium pointer-events-none">
        {new Date(note.updated_at * 1000).toLocaleDateString()}
      </div>
    </div>
  );
}

// --- DROPPABLE COMPONENT ---
function NotebookItem({ notebook, isSelected, level, onSelect, onAddSub, onDelete, children, isOverGlobal }: any) {
  const { isOver, setNodeRef } = useDroppable({
    id: `nb-${notebook.id}`,
    data: { notebookId: notebook.id }
  });

  return (
    <div ref={setNodeRef} className="w-full">
      <div 
        onClick={() => onSelect(notebook.id)}
        className={cn(
          "flex items-center justify-between text-gray-400 p-2 rounded cursor-pointer group transition-all mx-1",
          isSelected && "bg-[#2A2A2A] text-white",
          isOver && "bg-[#00A82D] text-white ring-2 ring-white/20 scale-[1.02]"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {children}
          <Book size={18} className={isSelected ? "text-[#00A82D]" : ""} />
          <span className="text-sm truncate font-medium">{notebook.name}</span>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Plus size={14} className="hover:text-white" onClick={(e) => onAddSub(e, notebook.id)} />
          <Trash2 size={14} className="hover:text-red-500" onClick={(e) => onDelete(e, notebook.id)} />
        </div>
      </div>
    </div>
  );
}

// --- MAIN APP ---
function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<number>>(new Set());
  
  // Custom Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, noteId: number } | null>(null);

  // Resize
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [listWidth, setListWidth] = useState(350);
  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fetchData = useCallback(async () => {
    try {
      const nbs = await invoke<Notebook[]>("get_notebooks");
      setNotebooks(nbs);
      const allNotes = await invoke<Note[]>("get_notes", { notebookId: selectedNotebookId });
      setNotes(allNotes);
    } catch (err) { console.error(err); }
  }, [selectedNotebookId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) { setTitle(note.title); setContent(note.content); }
  }, [selectedNoteId]);

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

  useEffect(() => {
    if (selectedNoteId === null) return;
    const timeout = setTimeout(async () => {
      const currentNote = notes.find(n => n.id === selectedNoteId);
      if (currentNote && (title !== currentNote.title || content !== currentNote.content)) {
        await invoke("upsert_note", { id: selectedNoteId, title, content, notebookId: currentNote.notebook_id });
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title, content, updated_at: Date.now()/1000 } : n));
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, selectedNoteId]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.data.current) {
      const noteId = active.data.current.noteId;
      const notebookId = over.id === 'all-notes' ? null : (over.data.current as any).notebookId;
      await invoke("move_note", { noteId, notebookId });
      fetchData();
    }
  };

  const handleContextMenu = (e: React.MouseEvent, noteId: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, noteId });
  };

  const moveNote = async (noteId: number, notebookId: number | null) => {
    await invoke("move_note", { noteId, notebookId });
    setContextMenu(null);
    fetchData();
  };

  const deleteNote = async (e: any, id: number) => {
    e.stopPropagation();
    if (await ask("Delete note permanently?", { title: "Confirm", type: "warning" })) {
      await invoke("delete_note", { id });
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchData();
    }
  };

  const deleteNotebook = async (e: any, id: number) => {
    e.stopPropagation();
    if (await ask("Delete notebook?", { title: "Confirm", type: "warning" })) {
      await invoke("delete_notebook", { id });
      if (selectedNotebookId === id) setSelectedNotebookId(null);
      fetchData();
    }
  };

  const renderNotebookRecursive = (nb: Notebook, level: number = 0) => {
    const children = notebooks.filter(c => c.parent_id === nb.id);
    const isExpanded = expandedNotebooks.has(nb.id);
    return (
      <div key={nb.id}>
        <NotebookItem 
          notebook={nb} 
          isSelected={selectedNotebookId === nb.id} 
          level={level}
          onSelect={setSelectedNotebookId}
          onAddSub={(e: any, pid: number) => { e.stopPropagation(); const name = window.prompt("Name:"); if(name) invoke("create_notebook", {name, parentId: pid}).then(() => fetchData()); }}
          onDelete={deleteNotebook}
        >
          <div onClick={(e) => { e.stopPropagation(); setExpandedNotebooks(prev => { const n = new Set(prev); n.has(nb.id) ? n.delete(nb.id) : n.add(nb.id); return n; }); }}>
            {children.length > 0 ? <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} /> : <div className="w-[14px]" />}
          </div>
        </NotebookItem>
        {isExpanded && children.map(c => renderNotebookRecursive(c, level + 1))}
      </div>
    );
  };

  const { setNodeRef: setAllNotesRef, isOver: isOverAll } = useDroppable({ id: 'all-notes' });

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none" onClick={() => setContextMenu(null)}>
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="bg-[#1A1A1A] flex flex-col shrink-0 relative">
          <div className="p-4 flex flex-col h-full">
            <div className="flex items-center gap-2 text-white mb-6 px-2">
              <div className="w-8 h-8 bg-[#00A82D] rounded-full flex items-center justify-center font-bold text-xs">M</div>
              <span className="font-semibold text-sm truncate uppercase tracking-widest">Notes Classic</span>
            </div>
            <button onClick={async () => { const id = await invoke<number>("upsert_note", { id: null, title: "New Note", content: "", notebookId: selectedNotebookId }); await fetchData(); setSelectedNoteId(id); }} className="w-fit bg-[#00A82D] hover:bg-[#008f26] text-white flex items-center gap-2 py-2 px-6 rounded-full transition-colors text-sm font-medium mb-8 ml-2 shadow-lg shrink-0">
              <Plus size={20} strokeWidth={3} /><span>New Note</span>
            </button>
            <nav className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              <div ref={setAllNotesRef} onClick={() => setSelectedNotebookId(null)} className={cn("flex items-center gap-3 text-gray-400 p-2 rounded cursor-pointer mx-1 transition-all", selectedNotebookId === null && "bg-[#2A2A2A] text-white", isOverAll && "bg-[#00A82D] text-white scale-105")}>
                <FileText size={18} className={selectedNotebookId === null ? "text-[#00A82D]" : ""} />
                <span className="text-sm font-medium">All Notes</span>
              </div>
              <div className="pt-6 pb-2 px-3 flex justify-between items-center text-gray-500 uppercase text-[10px] font-bold tracking-widest">
                <span>Notebooks</span>
                <FolderPlus size={16} className="cursor-pointer hover:text-white" onClick={() => { const name = window.prompt("Name:"); if(name) invoke("create_notebook", {name, parentId: null}).then(() => fetchData()); }} />
              </div>
              {notebooks.filter(nb => !nb.parent_id).map(nb => renderNotebookRecursive(nb))}
            </nav>
          </div>
          <div onMouseDown={() => { isResizingSidebar.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
        </div>

        {/* Note List */}
        <div style={{ width: listWidth }} className="border-r border-gray-200 bg-white flex flex-col shrink-0 relative">
          <div className="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8]">
            <h2 className="text-xs uppercase tracking-[0.1em] text-gray-500 font-bold mb-4 italic truncate">{selectedNotebookId ? notebooks.find(n => n.id === selectedNotebookId)?.name : "All Notes"}</h2>
            <div className="relative"><Search className="absolute left-3 top-2 text-gray-400" size={14} /><input type="text" placeholder="Search..." className="w-full bg-white border border-gray-200 rounded py-1.5 pl-9 pr-4 text-sm outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {notes.filter(n => n.title.toLowerCase().includes(searchTerm.toLowerCase())).map(note => (
              <DraggableNote key={note.id} note={note} isSelected={selectedNoteId === note.id} onClick={() => setSelectedNoteId(note.id)} onDelete={deleteNote} onContextMenu={handleContextMenu} />
            ))}
          </div>
          <div onMouseDown={() => { isResizingList.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          {selectedNoteId ? (
            <div className="flex flex-col h-full">
              <div className="px-10 py-6 shrink-0 bg-white"><input className="w-full text-4xl font-light text-[#222] border-none focus:ring-0 outline-none" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="flex-1 overflow-hidden"><Editor content={content} onChange={setContent} /></div>
            </div>
          ) : <div className="flex-1 flex flex-col items-center justify-center text-gray-400"><FileText size={80} strokeWidth={1} className="mb-6 text-gray-100" /><p className="text-lg font-light">Select a note</p></div>}
        </div>

        {/* Custom Context Menu */}
        {contextMenu && (
          <div className="fixed bg-white shadow-2xl border border-gray-200 rounded-lg py-2 z-[9999] min-w-[200px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 text-[10px] uppercase font-bold text-gray-400 border-b border-gray-100 mb-1">Move to Notebook</div>
            <div className="max-h-[300px] overflow-y-auto">
              <div onClick={() => moveNote(contextMenu.noteId, null)} className="px-4 py-2 hover:bg-[#00A82D] hover:text-white cursor-pointer text-sm flex items-center gap-2"><FileText size={14}/> None (All Notes)</div>
              {notebooks.map(nb => (
                <div key={nb.id} onClick={() => moveNote(contextMenu.noteId, nb.id)} className="px-4 py-2 hover:bg-[#00A82D] hover:text-white cursor-pointer text-sm flex items-center gap-2"><Book size={14}/> {nb.name}</div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-1 pt-1">
              <div onClick={() => { deleteNote(new MouseEvent('click'), contextMenu.noteId); setContextMenu(null); }} className="px-4 py-2 hover:bg-red-500 hover:text-white cursor-pointer text-sm flex items-center gap-2 text-red-500"><Trash2 size={14}/> Delete Note</div>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}

export default App;
