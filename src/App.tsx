import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Trash2, Search, FileText, ChevronDown, Settings } from "lucide-react";
import Editor from "./components/Editor";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Note {
  id: number;
  title: string;
  content: string;
  updated_at: number;
  sync_status: number;
}

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  const fetchNotes = useCallback(async () => {
    try {
      const allNotes = await invoke<Note[]>("get_notes");
      setNotes(allNotes);
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title);
      setContent(selectedNote.content);
    }
  }, [selectedNoteId, notes]);

  // Auto-save logic
  useEffect(() => {
    if (selectedNoteId === null) return;

    const timeout = setTimeout(async () => {
      const currentNote = notes.find(n => n.id === selectedNoteId);
      if (currentNote && (title !== currentNote.title || content !== currentNote.content)) {
        try {
          await invoke("upsert_note", {
            id: selectedNoteId,
            title,
            content
          });
          // Update local state without full refetch to avoid flicker
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
        content: ""
      });
      await fetchNotes();
      setSelectedNoteId(id);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const deleteNote = async (id: number) => {
    try {
      await invoke("delete_note", { id });
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    n.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-screen w-full bg-white text-[#333] font-sans overflow-hidden select-none">
      {/* Sidebar (Navigation Menu) */}
      <div className="w-[240px] bg-[#1A1A1A] flex flex-col shrink-0">
        <div className="p-4 flex flex-col h-full">
          <div className="flex items-center gap-2 text-white mb-6 px-2">
            <div className="w-8 h-8 bg-[#00A82D] rounded-full flex items-center justify-center font-bold text-xs">M</div>
            <span className="font-semibold text-sm">Monstre's Notes</span>
            <ChevronDown size={14} className="text-gray-500" />
          </div>

          <button 
            onClick={createNote}
            className="w-fit bg-[#00A82D] hover:bg-[#008f26] text-white flex items-center gap-2 py-2 px-6 rounded-full transition-colors text-sm font-medium mb-8 ml-2 shadow-lg"
          >
            <Plus size={20} strokeWidth={3} />
            <span>New Note</span>
          </button>

          <nav className="space-y-1">
            <div className="flex items-center gap-3 text-white p-2 bg-[#2A2A2A] rounded cursor-pointer transition-colors">
              <FileText size={18} className="text-[#00A82D]" />
              <span className="text-sm">All Notes</span>
            </div>
          </nav>

          <div className="mt-auto">
            <div className="flex items-center gap-3 text-gray-400 p-2 hover:bg-[#2A2A2A] rounded cursor-pointer transition-colors">
              <Settings size={18} />
              <span className="text-sm">Sync Settings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Note List (Middle Panel) */}
      <div className="w-[350px] border-r border-gray-200 bg-white flex flex-col shrink-0">
        <div className="px-6 py-4 border-b border-gray-200 bg-[#F8F8F8]">
          <h2 className="text-xs uppercase tracking-[0.1em] text-gray-500 font-bold mb-4">Notes</h2>
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
          {filteredNotes.length > 0 ? filteredNotes.map((note) => (
            <div 
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              className={cn(
                "px-6 py-5 border-b border-gray-100 cursor-pointer group hover:bg-[#F8F8F8] transition-colors relative",
                selectedNoteId === note.id && "bg-white ring-1 ring-[#00A82D] z-10"
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <h3 className={cn(
                  "font-semibold text-sm truncate pr-4 text-[#222]",
                  selectedNoteId === note.id && "text-[#00A82D]"
                )}>{note.title || "Untitled"}</h3>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">
                {note.content.replace(/<[^>]*>/g, '') || "No additional text"}
              </p>
              <div className="text-[10px] text-gray-400 uppercase font-medium">
                {new Date(note.updated_at * 1000).toLocaleDateString()}
              </div>
            </div>
          )) : (
            <div className="p-8 text-center text-gray-400 text-sm italic">
              No notes found
            </div>
          )}
        </div>
      </div>

      {/* Note View (Editor Panel) */}
      <div className="flex-1 flex flex-col bg-white">
        {selectedNoteId ? (
          <>
            <div className="px-10 py-6">
              <input 
                className="w-full text-4xl font-light text-[#222] border-none focus:ring-0 outline-none placeholder:text-gray-200"
                value={title}
                placeholder="Title"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-hidden px-6">
              <Editor content={content} onChange={setContent} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-white">
            <FileText size={80} strokeWidth={1} className="mb-6 text-gray-100" />
            <p className="text-lg font-light">Select a note to view or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
