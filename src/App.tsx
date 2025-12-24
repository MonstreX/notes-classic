import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { ask } from "@tauri-apps/api/dialog";
import { Plus, Trash2, Search, FileText, Book, FolderPlus, ChevronRight } from "lucide-react";
import { 
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent,
  closestCenter, defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import Editor from "./components/Editor";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface Notebook { id: number; name: string; parent_id: number | null; sort_order: number; }
interface Note { id: number; title: string; content: string; updated_at: number; notebook_id: number | null; }

const STORAGE_KEY = "notes_classic_v3_state";

// --- DRAGGABLE NOTE ---
function DraggableNote({ note, isSelected, onClick, onDelete, onContextMenu }: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `note-${note.id}`, 
    data: { id: note.id, type: 'note', title: note.title }
  });

  return (
    <div 
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(e, note.id)}
      className={cn(
        "px-6 py-5 border-b border-gray-100 cursor-pointer group hover:bg-[#F8F8F8] relative bg-white",
        isSelected && "ring-1 ring-[#00A82D] z-10",
        isDragging && "opacity-20 shadow-none"
      )}
    >
      <div className="flex justify-between items-start mb-1 pointer-events-none">
        <h3 className={cn("font-semibold text-sm truncate pr-4 text-[#222]", isSelected && "text-[#00A82D]")}>
          {note.title || "Untitled"}
        </h3>
        <button 
          onMouseDown={(e) => e.stopPropagation()} 
          onClick={(e) => onDelete(e, note.id)}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 pointer-events-auto transition-opacity"
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

// --- NOTEBOOK ITEM ---
function NotebookItem({ notebook, isSelected, level, onSelect, onAddSub, onDelete, isExpanded, onToggle }: any) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `nb-drag-${notebook.id}`, 
    data: { id: notebook.id, type: 'notebook', name: notebook.name }
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `nb-drop-${notebook.id}`,
    data: { id: notebook.id, type: 'notebook' }
  });

  const setRefs = (el: HTMLElement | null) => { setDragRef(el); setDropRef(el); };

  return (
    <div ref={setRefs} className={cn("w-full py-0.5 transition-opacity", isDragging && "opacity-20")}>
      <div 
        onClick={() => onSelect(notebook.id)}
        {...listeners} {...attributes}
        className={cn(
          "flex items-center text-gray-400 p-2 rounded cursor-pointer group transition-all mx-1 hover:bg-[#2A2A2A]",
          isSelected && "bg-[#2A2A2A] text-white",
          isOver && !isDragging && "bg-[#00A82D] text-white ring-2 ring-[#00A82D]/50 scale-[1.02]"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Left: Icon and Name */}
        <div className="flex items-center gap-3 overflow-hidden pointer-events-none flex-1">
          <Book size={18} className={cn("shrink-0 w-[18px]", isSelected ? "text-[#00A82D]" : "", isOver && !isDragging && "text-white")} />
          <span className="text-sm truncate font-medium">{notebook.name}</span>
        </div>
        
        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto shrink-0 ml-2">
          <button onClick={(e) => onAddSub(e, notebook.id)} title="Add sub-notebook" className="p-1 hover:text-white transition-colors">
            <Plus size={14} />
          </button>
          <button onClick={(e) => onToggle(e, notebook.id)} title={isExpanded ? "Collapse" : "Expand"} className="p-1 hover:text-white transition-colors">
            <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} />
          </button>
          <button onClick={(e) => onDelete(e, notebook.id)} title="Delete notebook" className="p-1 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [uiState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : { sidebarWidth: 240, listWidth: 350, selectedNotebookId: null, selectedNoteId: null, expandedNotebooks: [] };
  });

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(uiState.selectedNotebookId);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(uiState.selectedNoteId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<number>>(new Set(uiState.expandedNotebooks));
  
  const [sidebarWidth, setSidebarWidth] = useState(uiState.sidebarWidth);
  const [listWidth, setListWidth] = useState(uiState.listWidth);
  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, noteId: number } | null>(null);
  const [activeDragData, setActiveDragData] = useState<any>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sidebarWidth, listWidth, selectedNotebookId, selectedNoteId,
      expandedNotebooks: Array.from(expandedNotebooks)
    }));
  }, [sidebarWidth, listWidth, selectedNotebookId, selectedNoteId, expandedNotebooks]);

  const fetchData = useCallback(async () => {
    try {
      const nbs = await invoke<Notebook[]>("get_notebooks");
      setNotebooks(nbs);
      const allNotes = await invoke<Note[]>("get_notes", { notebook_id: selectedNotebookId });
      setNotes(allNotes);
    } catch (err) { console.error(err); }
  }, [selectedNotebookId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) { setTitle(note.title); setContent(note.content); }
  }, [selectedNoteId, notes]);

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
    if (!selectedNoteId) return;
    const timeout = setTimeout(async () => {
      const currentNote = notes.find(n => n.id === selectedNoteId);
      if (currentNote && (title !== currentNote.title || content !== currentNote.content)) {
        await invoke("upsert_note", { id: selectedNoteId, title, content, notebook_id: currentNote.notebook_id });
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title, content, updated_at: Date.now()/1000 } : n));
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, selectedNoteId]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragData(null);
    if (!over) return;

    const activeType = active.data.current?.type;
    const activeId = active.data.current?.id;
    const isRootTarget = over.id === 'all-notes' || over.id === 'nb-root-zone';
    const overId = (over.data.current as any)?.id;

    try {
      if (activeType === 'note') {
        await invoke("move_note", { note_id: activeId, notebook_id: isRootTarget ? null : overId });
      } else if (activeType === 'notebook') {
        if (activeId === overId) return;
        await invoke("move_notebook", { id: activeId, parent_id: isRootTarget ? null : overId, sort_order: 0 });
      }
      fetchData();
    } catch (e) { console.error(e); }
  };

  const deleteNote = async (id: number) => {
    if (await ask("Delete note?", { title: "Confirm", type: "warning" })) {
      await invoke("delete_note", { id });
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchData();
    }
  };

  const deleteNotebook = async (id: number) => {
    if (await ask("Delete notebook and all sub-folders?", { title: "Confirm", type: "warning" })) {
      await invoke("delete_notebook", { id });
      if (selectedNotebookId === id) setSelectedNotebookId(null);
      fetchData();
    }
  };

  const renderNotebookRecursive = (nb: Notebook, level: number = 0) => {
    const children = notebooks.filter(c => c.parent_id === nb.id).sort((a,b) => a.sort_order - b.sort_order);
    const isExpanded = expandedNotebooks.has(nb.id);
    return (
      <div key={nb.id}>
        <NotebookItem 
          notebook={nb} isSelected={selectedNotebookId === nb.id} level={level} 
          onSelect={setSelectedNotebookId} onDelete={(e:any, id:number) => { e.stopPropagation(); deleteNotebook(id); }}
          isExpanded={isExpanded} onToggle={(e:any, id:number) => { e.stopPropagation(); setExpandedNotebooks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }}
          onAddSub={(e: any, pid: number) => { 
            e.stopPropagation(); const name = window.prompt("Name:"); 
            if(name) invoke("create_notebook", {name, parent_id: pid}).then(() => fetchData()); 
          }}
        />
        {isExpanded && children.map(c => renderNotebookRecursive(c, level + 1))}
      </div>
    );
  };

  const { setNodeRef: setAllNotesRef, isOver: isOverAll } = useDroppable({ id: 'all-notes', data: { type: 'root', id: null } });
  const { setNodeRef: setNbRootRef, isOver: isOverNbRoot } = useDroppable({ id: 'nb-root-zone', data: { type: 'root', id: null } });

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e) => setActiveDragData(e.active.data.current)} onDragEnd={onDragEnd}>
      <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none" onClick={() => setContextMenu(null)}>
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="bg-[#1A1A1A] flex flex-col shrink-0 relative">
          <div className="p-4 flex flex-col h-full">
            <div className="flex items-center gap-2 text-white mb-6 px-2 shrink-0">
              <div className="w-8 h-8 bg-[#00A82D] rounded-full flex items-center justify-center font-bold text-xs text-white uppercase">M</div>
              <span className="font-semibold text-sm truncate uppercase tracking-widest">Notes Classic</span>
            </div>
            <button 
              onClick={async () => { const id = await invoke<number>("upsert_note", { id: null, title: "New Note", content: "", notebook_id: selectedNotebookId }); await fetchData(); setSelectedNoteId(id); }} 
              className="w-fit bg-[#00A82D] hover:bg-[#008f26] text-white flex items-center gap-2 py-2 px-6 rounded-full transition-colors text-sm font-medium mb-8 ml-2 shadow-lg shrink-0"
            >
              <Plus size={20} strokeWidth={3} /><span>New Note</span>
            </button>
            
            <nav className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-1">
              <div 
                ref={setAllNotesRef} 
                onClick={() => setSelectedNotebookId(null)} 
                className={cn(
                  "flex items-center gap-3 text-gray-400 p-2 rounded cursor-pointer mx-1 transition-all", 
                  selectedNotebookId === null && "bg-[#2A2A2A] text-white", 
                  isOverAll && "bg-[#00A82D] text-white"
                )}
              >
                <FileText size={18} className={cn("shrink-0 w-[18px]", selectedNotebookId === null ? "text-[#00A82D]" : "")} />
                <span className="text-sm font-medium">All Notes</span>
              </div>
              
              <div 
                ref={setNbRootRef} 
                className={cn(
                  "mt-4 pt-4 pb-2 px-3 flex justify-between items-center text-gray-500 uppercase text-[10px] font-bold tracking-widest shrink-0 transition-all rounded mx-1", 
                  isOverNbRoot && "bg-[#00A82D] text-white"
                )}
              >
                <span>Notebooks</span>
                <FolderPlus size={16} title="Create root notebook" className="cursor-pointer hover:text-white transition-colors" onClick={() => { const name = window.prompt("Notebook name:"); if(name) invoke("create_notebook", {name, parent_id: null}).then(() => fetchData()); }} />
              </div>
              
              {notebooks.filter(nb => !nb.parent_id).sort((a,b) => a.sort_order - b.sort_order).map(nb => renderNotebookRecursive(nb))}
            </nav>
          </div>
          <div onMouseDown={() => { isResizingSidebar.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
        </div>

        {/* Note List & Editor (Unchanged logic, just fixed styles) */}
        <div style={{ width: listWidth }} className="border-r border-gray-200 bg-white flex flex-col shrink-0 relative">
          <div className="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8] shrink-0">
            <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-4 italic truncate">{selectedNotebookId ? notebooks.find(n => n.id === selectedNotebookId)?.name : "All Notes"}</h2>
            <div className="relative"><Search className="absolute left-3 top-2 text-gray-400" size={14} /><input type="text" placeholder="Search..." className="w-full bg-white border border-gray-200 rounded py-1.5 pl-9 pr-4 text-sm outline-none focus:border-[#00A82D]" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {notes.filter(n => n.title.toLowerCase().includes(searchTerm.toLowerCase())).map(note => (
              <DraggableNote key={note.id} note={note} isSelected={selectedNoteId === note.id} onClick={() => setSelectedNoteId(note.id)} onDelete={(e:any, id:number) => deleteNote(id)} onContextMenu={(e: any, id: number) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, noteId: id }); }} />
            ))}
          </div>
          <div onMouseDown={() => { isResizingList.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#00A82D] z-50 transition-colors" />
        </div>

        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          {selectedNoteId ? (
            <div className="flex flex-col h-full">
              <div className="px-10 py-6 shrink-0 bg-white shadow-sm z-10"><input className="w-full text-4xl font-light text-[#222] border-none focus:ring-0 outline-none" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="flex-1 overflow-hidden"><Editor content={content} onChange={setContent} /></div>
            </div>
          ) : <div className="flex-1 flex flex-col items-center justify-center text-gray-400"><FileText size={80} strokeWidth={1} className="mb-6 text-gray-100" /><p className="text-lg font-light">Select a note</p></div>}
        </div>

        <DragOverlay>
          {activeDragData ? (
            <div className={cn("px-4 py-3 bg-white border shadow-2xl rounded-lg opacity-90 min-w-[200px]", activeDragData.type === 'note' ? "border-[#00A82D]" : "border-blue-500")}>
              <div className="flex items-center gap-2">{activeDragData.type === 'note' ? <FileText size={16} className="text-[#00A82D]"/> : <Book size={16} className="text-blue-500"/>}<span className="font-semibold text-sm truncate">{activeDragData.title || activeDragData.name}</span></div>
            </div>
          ) : null}
        </DragOverlay>

        {contextMenu && createPortal(
          <div className="fixed bg-white shadow-2xl border border-gray-200 rounded-lg py-2 z-[9999] min-w-[220px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 text-[10px] uppercase font-bold text-gray-400 border-b border-gray-100 mb-1 tracking-widest">Move to Notebook</div>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              <div onClick={async () => { await invoke("move_note", { note_id: contextMenu.noteId, notebook_id: null }); setContextMenu(null); fetchData(); }} className="px-4 py-2 hover:bg-[#00A82D] hover:text-white cursor-pointer text-sm flex items-center gap-2 transition-colors"><FileText size={14}/> None (All Notes)</div>
              {notebooks.map(nb => (
                <div key={nb.id} onClick={async () => { await invoke("move_note", { note_id: contextMenu.noteId, notebook_id: nb.id }); setContextMenu(null); fetchData(); }} className="px-4 py-2 hover:bg-[#00A82D] hover:text-white cursor-pointer text-sm flex items-center gap-2 transition-colors"><Book size={14}/> {nb.name}</div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-1 pt-1"><div onClick={() => { deleteNote(contextMenu.noteId); setContextMenu(null); }} className="px-4 py-2 hover:bg-red-500 hover:text-white cursor-pointer text-sm flex items-center gap-2 text-red-500 transition-colors"><Trash2 size={14}/> Delete Note</div></div>
          </div>,
          document.body
        )}
      </div>
    </DndContext>
  );
}

export default App;
