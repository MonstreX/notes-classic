import type { Notebook, NoteListItem, NoteDetail, NotesListView, NotesSortBy, NotesSortDir, Tag } from "./types";
import type { LanguageCode } from "../services/i18n";

export type AppState = {
  notebooks: Notebook[];
  notes: NoteListItem[];
  noteCounts: Map<number, number>;
  totalNotes: number;
  trashedCount: number;
  notesListView: NotesListView;
  notesSortBy: NotesSortBy;
  notesSortDir: NotesSortDir;
  tags: Tag[];
  noteTags: Tag[];
  selectedNotebookId: number | null;
  selectedTagId: number | null;
  selectedNoteId: number | null;
  selectedNoteIds: Set<number>;
  selectedTrash: boolean;
  expandedNotebooks: Set<number>;
  expandedTags: Set<number>;
  tagsSectionExpanded: boolean;
  sidebarWidth: number;
  listWidth: number;
  deleteToTrash: boolean;
  language: LanguageCode;
  title: string;
  content: string;
  activeNote: NoteDetail | null;
  isLoaded: boolean;
  isNoteLoading: boolean;
  historyBack: number[];
  historyForward: number[];
  historyCurrent: number | null;
};

type Listener = () => void;

let state: AppState = {
  notebooks: [],
  notes: [],
  noteCounts: new Map(),
  totalNotes: 0,
  trashedCount: 0,
  notesListView: "detailed",
  notesSortBy: "updated",
  notesSortDir: "desc",
  tags: [],
  noteTags: [],
  selectedNotebookId: null,
  selectedTagId: null,
  selectedNoteId: null,
  selectedNoteIds: new Set(),
  selectedTrash: false,
  expandedNotebooks: new Set(),
  expandedTags: new Set(),
  tagsSectionExpanded: true,
  sidebarWidth: 240,
  listWidth: 350,
  deleteToTrash: true,
  language: "en",
  title: "",
  content: "",
  activeNote: null,
  isLoaded: false,
  isNoteLoading: false,
  historyBack: [],
  historyForward: [],
  historyCurrent: null,
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
    const draft: AppState = {
      ...state,
      noteCounts: new Map(state.noteCounts),
      selectedNoteIds: new Set(state.selectedNoteIds),
      expandedNotebooks: new Set(state.expandedNotebooks),
      expandedTags: new Set(state.expandedTags),
    };
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
