import type { Notebook, NoteListItem, NoteDetail, NotesListView } from "./types";

export type AppState = {
  notebooks: Notebook[];
  notes: NoteListItem[];
  noteCounts: Map<number, number>;
  totalNotes: number;
  notesListView: NotesListView;
  selectedNotebookId: number | null;
  selectedNoteId: number | null;
  expandedNotebooks: Set<number>;
  sidebarWidth: number;
  listWidth: number;
  searchTerm: string;
  title: string;
  content: string;
  activeNote: NoteDetail | null;
  isLoaded: boolean;
  isNoteLoading: boolean;
};

type Listener = () => void;

let state: AppState = {
  notebooks: [],
  notes: [],
  noteCounts: new Map(),
  totalNotes: 0,
  notesListView: "detailed",
  selectedNotebookId: null,
  selectedNoteId: null,
  expandedNotebooks: new Set(),
  sidebarWidth: 240,
  listWidth: 350,
  searchTerm: "",
  title: "",
  content: "",
  activeNote: null,
  isLoaded: false,
  isNoteLoading: false,
};

const listeners = new Set<Listener>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

export const appStore = {
  getState: () => state,
  setState: (partial: Partial<AppState>) => {
    state = { ...state, ...partial };
    notify();
  },
  update: (updater: (draft: AppState) => void) => {
    const draft = { ...state };
    updater(draft);
    state = draft;
    notify();
  },
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
