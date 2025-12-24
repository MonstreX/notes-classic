import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Trash2, Search, FileText, ChevronDown, Settings, Book, FolderPlus, MoreVertical } from "lucide-react";
import Editor from "./components/Editor";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Notebook {
  id: number;
  name: string;
}

interface Note {
  id: number;
  title: string;
  content: string;
  updated_at: number;
  notebook_id: number | null;
}

function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Resize states
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [listWidth, setListWidth] = useState(350);
  const isResizingSidebar = useRef(false);
  const isResizingList = useRef(false);

  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  const fetchData = useCallback(async () => {
    try {
      const nbs = await invoke<Notebook[]>("get_notebooks");
      setNotebooks(nbs);
      const allNotes = await invoke<Note[]>("get_notes", { notebookId: selectedNotebookId });
      setNotes(allNotes);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    }
  }, [selectedNotebookId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title);
      setContent(selectedNote.content);
    }
  }, [selectedNoteId]);

  // Resize Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar.current) {
        setSidebarWidth(Math.max(150, Math.min(400, e.clientX)));
      } else if (isResizingList.current) {
        const newWidth = e.clientX - sidebarWidth;
        setListWidth(Math.max(200, Math.min(600, newWidth)));
      }
    };
    const handleMouseUp = () => {
      isResizingSidebar.current = false;
      isResizingList.current = false;
      document.body.classList.remove("select-none");
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarWidth]);

  // Auto-save
  useEffect(() => {
    if (selectedNoteId === null) return;
    const timeout = setTimeout(async () => {
      const currentNote = notes.find(n => n.id === selectedNoteId);
      if (currentNote && (title !== currentNote.title || content !== currentNote.content)) {
        try {
          await invoke("upsert_note", {
            id: selectedNoteId,
            title,
            content,
            notebookId: selectedNotebookId
          });
          setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title, content, updated_at: Date.now()/1000 } : n));
        } catch (err) {
          console.error("Failed to auto-save:", err);
        }
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, content, selectedNoteId]);

  const createNote = async () => {
    try {
      const id = await invoke<number>("upsert_note", {
        id: null,
        title: "Untitled Note",
        content: "",
        notebookId: selectedNotebookId
      });
      await fetchData();
      setSelectedNoteId(id);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const deleteNote = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this note?")) return;
    try {
      await invoke("delete_note", { id });
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchData();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  const createNotebook = async () => {
    const name = window.prompt("Enter notebook name:");
    if (!name) return;
    try {
      await invoke("create_notebook", { name });
      fetchData();
    } catch (err) {
      console.error("Failed to create notebook:", err);
    }
  };

  const deleteNotebook = async (id: number) => {
    if (!window.confirm("Delete notebook? Notes will be moved to 'All Notes'.")) return;
    try {
      await invoke("delete_notebook", { id });
      if (selectedNotebookId === id) setSelectedNotebookId(null);
      fetchData();
    } catch (err) {
      console.error("Failed to delete notebook:", err);
    }
  };

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    n.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none">
      {/* Sidebar */}
      <div style={{ width: sidebarWidth }} className="bg-[#1A1A1A] flex flex-col shrink-0 relative">
        <div className="p-4 flex flex-col h-full">
          <div className="flex items-center gap-2 text-white mb-6 px-2">
            <div className="w-8 h-8 bg-[#00A82D] rounded-full flex items-center justify-center font-bold text-xs">M</div>
            <span className="font-semibold text-sm truncate">Monstre's Notes</span>
          </div>

          <button 
            onClick={createNote}
            className="w-fit bg-[#00A82D] hover:bg-[#008f26] text-white flex items-center gap-2 py-2 px-6 rounded-full transition-colors text-sm font-medium mb-8 ml-2 shadow-lg shrink-0"
          >
            <Plus size={20} strokeWidth={3} />
            <span className="whitespace-nowrap">New Note</span>
          </button>

          <nav className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
            <div 
              onClick={() => setSelectedNotebookId(null)}
              className={cn(
                "flex items-center gap-3 text-gray-400 p-2 rounded cursor-pointer transition-colors",
                selectedNotebookId === null && "bg-[#2A2A2A] text-white"
              )}
            >
              <FileText size={18} className={selectedNotebookId === null ? "text-[#00A82D]" : ""} />
              <span className="text-sm">All Notes</span>
            </div>

            <div className="pt-4 pb-2 px-2 flex justify-between items-center text-gray-500 uppercase text-[10px] font-bold tracking-widest">
              <span>Notebooks</span>
              <FolderPlus size={14} className="cursor-pointer hover:text-white" onClick={createNotebook} />
            </div>

            {notebooks.map(nb => (
              <div 
                key={nb.id}
                onClick={() => setSelectedNotebookId(nb.id)}
                className={cn(
                  "flex items-center justify-between text-gray-400 p-2 rounded cursor-pointer group transition-colors",
                  selectedNotebookId === nb.id && "bg-[#2A2A2A] text-white"
                )}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <Book size={18} className={selectedNotebookId === nb.id ? "text-[#00A82D]" : ""} />
                  <span className="text-sm truncate">{nb.name}</span>
                </div>
                <Trash2 
                  size={12} 
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500" 
                  onClick={(e) => { e.stopPropagation(); deleteNotebook(nb.id); }}
                />
              </div>
            ))}
          </nav>
        </div>
        {/* Resize Handle 1 */}
        <div 
          onMouseDown={() => { isResizingSidebar.current = true; document.body.classList.add("select-none"); }}
          className="absolute right-0 top-0 bottom-0 resize-handle active:bg-[#00A82D]"
        />
      </div>

      {/* Note List */}
      <div style={{ width: listWidth }} className="border-r border-gray-200 bg-white flex flex-col shrink-0 relative">
        <div className="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8]">
          <h2 className="text-xs uppercase tracking-[0.1em] text-gray-500 font-bold mb-4 italic">
            {selectedNotebookId ? notebooks.find(n => n.id === selectedNotebookId)?.name : "All Notes"}
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-2 text-gray-400" size={14} />
            <input 
              type="text" 
              placeholder="Search..."
              className="w-full bg-white border border-gray-200 rounded py-1.5 pl-9 pr-4 text-sm focus:border-[#00A82D] outline-none transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map((note) => (
            <div 
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              className={cn(
                "px-6 py-5 border-b border-gray-100 cursor-pointer group hover:bg-[#F8F8F8] transition-colors relative",
                selectedNoteId === note.id && "bg-white ring-1 ring-[#00A82D] z-10"
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <h3 className={cn("font-semibold text-sm truncate pr-4 text-[#222]", selectedNoteId === note.id && "text-[#00A82D]")}>
                  {note.title || "Untitled"}
                </h3>
                <Trash2 
                  size={14} 
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500" 
                  onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                />
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">
                {note.content.replace(/<[^>]*>/g, '') || "No additional text"}
              </p>
              <div className="text-[10px] text-gray-400 uppercase font-medium">
                {new Date(note.updated_at * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
        {/* Resize Handle 2 */}
        <div 
          onMouseDown={() => { isResizingList.current = true; document.body.classList.add("select-none"); }}
          className="absolute right-0 top-0 bottom-0 resize-handle active:bg-[#00A82D]"
        />
      </div>

      {/* Editor Panel */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {selectedNoteId ? (
          <div className="flex flex-col h-full">
            <div className="px-10 py-6 shrink-0 bg-white z-20">
              <input 
                className="w-full text-4xl font-light text-[#222] border-none focus:ring-0 outline-none placeholder:text-gray-100"
                value={title}
                placeholder="Title"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <Editor content={content} onChange={setContent} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <FileText size={80} strokeWidth={1} className="mb-6 text-gray-100" />
            <p className="text-lg font-light">Select a note to view or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;