import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openNotebookDialog, openConfirmDialog } from "./dialogs";
import type { Notebook } from "./types";
import { appStore } from "./store";
import { logError } from "./logger";
import {
  ensureNotesScheme,
  normalizeEnmlContent,
  toDisplayContent,
  toStorageContent,
} from "./services/content";
import { cleanupSettings, loadSettings, persistSettings } from "./services/settings";
import {
  createNote,
  createNotebook,
  deleteNotebook,
  deleteNote,
  getNote,
  getNoteCounts,
  getNotes,
  getNotebooks,
  moveNotebook,
  moveNote,
  searchNotes,
  setNotesListView,
  updateNote,
} from "./services/notes";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");
const buildExcerpt = (value: string) => stripTags(value || "");

const sortNotes = (
  notes: Array<{ id: number; title: string; updatedAt: number }>,
  sortBy: "updated" | "title",
  sortDir: "asc" | "desc"
) => {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...notes].sort((a, b) => {
    let result = 0;
    if (sortBy === "title") {
      result = (a.title || "").localeCompare(b.title || "");
    } else {
      result = (a.updatedAt || 0) - (b.updatedAt || 0);
    }
    if (result === 0) {
      result = a.id - b.id;
    }
    return result * dir;
  });
};

const buildSearchQuery = (value: string) => {
  const tokens = value
    .replace(/["']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `${token}*`).join(" AND ");
};

const getOrderedChildren = (notebooks: Notebook[], parentId: number | null) => {
  const typeFilter = parentId === null ? "stack" : "notebook";
  return notebooks
    .filter((nb) => nb.parentId === parentId && nb.notebookType === typeFilter)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
};

const isDescendant = (notebooks: Notebook[], candidateParentId: number | null, notebookId: number) => {
  if (candidateParentId === null) return false;
  const parentMap = new Map<number, number | null>();
  notebooks.forEach((nb) => parentMap.set(nb.id, nb.parentId));
  let current = candidateParentId;
  while (current !== null) {
    if (current === notebookId) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
};

const fetchData = async () => {
  const state = appStore.getState();
  if (!state.isLoaded) return;
  try {
    const searchTerm = state.searchTerm.trim();
    const searchQuery = buildSearchQuery(searchTerm);
    const notesPromise = searchQuery.length > 0
      ? searchNotes(searchQuery, state.selectedNotebookId)
      : getNotes(state.selectedNotebookId);
    const [nbs, filteredNotes, counts] = await Promise.all([
      getNotebooks(),
      notesPromise,
      getNoteCounts(),
    ]);
    const notesWithExcerpt = filteredNotes.map((note) => ({
      ...note,
      excerpt: buildExcerpt(note.content || ""),
    }));
    const sortedNotes = sortNotes(notesWithExcerpt, state.notesSortBy, state.notesSortDir);
    const map = new Map<number, number>();
    counts.perNotebook.forEach((item) => {
      map.set(item.notebookId, item.count);
    });
    let nextSelectedNoteId = state.selectedNoteId;
    const hasSelected = notesWithExcerpt.some((note) => note.id === state.selectedNoteId);
    if (state.selectedNotebookId !== null || searchQuery.length > 0) {
      nextSelectedNoteId = hasSelected ? state.selectedNoteId : (sortedNotes[0]?.id ?? null);
    }
    const selectionChanged = nextSelectedNoteId !== state.selectedNoteId;
    const nextState: Partial<typeof state> = {
      notebooks: nbs,
      notes: sortedNotes,
      noteCounts: map,
      totalNotes: counts.total,
      selectedNoteId: nextSelectedNoteId,
    };
    if (selectionChanged && nextSelectedNoteId !== null) {
      nextState.isNoteLoading = true;
    }
    appStore.setState(nextState);
    if (nextSelectedNoteId !== null && (selectionChanged || state.activeNote?.id !== nextSelectedNoteId)) {
      await loadSelectedNote();
    }
  } catch (err) {
    console.error("Fetch Error:", err);
  }
};

let noteLoadToken = 0;
let searchTimer: number | null = null;

const loadSelectedNote = async () => {
  const initialState = appStore.getState();
  const noteId = initialState.selectedNoteId;
  if (!noteId) {
    appStore.setState({ activeNote: null, title: "", content: "", isNoteLoading: false });
    return;
  }
  noteLoadToken += 1;
  const token = noteLoadToken;
  appStore.setState({ isNoteLoading: true });
  try {
    const note = await getNote(noteId);
    if (!note) {
      appStore.setState({ activeNote: null, title: "", content: "" });
      return;
    }
    const currentState = appStore.getState();
    if (currentState.selectedNoteId !== noteId) return;
    const normalized = ensureNotesScheme(normalizeEnmlContent(note.content));
    const displayContent = await toDisplayContent(normalized);
    const finalNote = displayContent !== note.content ? { ...note, content: displayContent } : note;
    appStore.setState({ activeNote: finalNote, title: finalNote.title, content: finalNote.content });
  } catch (e) {
    logError("[note] load failed", e);
  }
  finally {
    if (token === noteLoadToken) {
      appStore.setState({ isNoteLoading: false });
    }
  }
};

let saveTimer: number | null = null;

const scheduleAutosave = () => {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const state = appStore.getState();
    const currentNote = state.activeNote;
    if (!currentNote || currentNote.id !== state.selectedNoteId) return;
    if (state.title !== currentNote.title || state.content !== currentNote.content) {
      const storageContent = toStorageContent(state.content);
      await updateNote(state.selectedNoteId, state.title, storageContent, currentNote.notebookId);
      const updatedAt = Date.now() / 1000;
      const excerpt = buildExcerpt(state.content);
      appStore.setState({
        activeNote: { ...currentNote, title: state.title, content: state.content, updatedAt },
        notes: state.notes.map((n) => n.id === state.selectedNoteId ? { ...n, title: state.title, content: state.content, excerpt, updatedAt } : n),
      });
    }
  }, 1000);
};

export const actions = {
  setSearchTerm: (value: string) => appStore.setState({ searchTerm: value }),
  setTitle: (value: string) => appStore.setState({ title: value }),
  setContent: (value: string) => appStore.setState({ content: value }),
  selectNote: async (id: number) => {
    const state = appStore.getState();
    if (state.selectedNoteId === id) return;
    appStore.setState({ selectedNoteId: id, isNoteLoading: true });
    await loadSelectedNote();
  },
  selectNotebook: (id: number | null) => appStore.setState({ selectedNotebookId: id }),
  toggleNotebook: (id: number) => {
    const current = appStore.getState().expandedNotebooks;
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    appStore.setState({ expandedNotebooks: next });
  },
  setSidebarWidth: (value: number) => appStore.setState({ sidebarWidth: value }),
  setListWidth: (value: number) => appStore.setState({ listWidth: value }),
  setNotesListView: (value: "compact" | "detailed") => appStore.setState({ notesListView: value }),
  setNotesSort: (sortBy: "updated" | "title", sortDir: "asc" | "desc") => {
    const state = appStore.getState();
    const sorted = sortNotes(state.notes, sortBy, sortDir);
    appStore.setState({ notesSortBy: sortBy, notesSortDir: sortDir, notes: sorted });
  },
  createNote: async () => {
    const state = appStore.getState();
    const id = await createNote("New Note", "", state.selectedNotebookId);
    await fetchData();
    await actions.selectNote(id);
  },
  createNoteInNotebook: async (notebookId: number) => {
    appStore.setState({ selectedNotebookId: notebookId });
    const id = await createNote("New Note", "", notebookId);
    await fetchData();
    await actions.selectNote(id);
  },
  deleteNote: async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete note",
      message: "Are you sure you want to delete this note?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const state = appStore.getState();
    const isCurrent = state.selectedNoteId === id;
    const nextNotes = state.notes.filter((note) => note.id !== id);

    if (isCurrent) {
      if (nextNotes.length > 0) {
        appStore.setState({ selectedNoteId: nextNotes[0].id });
      } else if (state.selectedNotebookId !== null) {
        try {
          const allNotes = await getNotes(null);
          if (allNotes.length > 0) {
            appStore.setState({ selectedNotebookId: null, selectedNoteId: allNotes[0].id });
          } else {
            appStore.setState({ selectedNoteId: null, activeNote: null, title: "", content: "" });
          }
        } catch (e) {
          logError("[note] fallback selection failed", e);
          appStore.setState({ selectedNoteId: null, activeNote: null, title: "", content: "" });
        }
      } else {
        appStore.setState({ selectedNoteId: null, activeNote: null, title: "", content: "" });
      }
    }

    await deleteNote(id);
    const postState = appStore.getState();
    appStore.setState({
      notes: nextNotes,
      selectedNoteId: postState.selectedNoteId,
      activeNote: postState.activeNote,
      title: postState.title,
      content: postState.content,
    });
    document.querySelectorAll("[data-dialog-overlay], .context-menu").forEach((el) => el.remove());
    document.body.style.cursor = "";
    fetchData();
  },
  createNotebook: async (parentId: number | null) => {
    const name = await openNotebookDialog({ parentId });
    if (!name) return;
    await createNotebook(name, parentId);
    fetchData();
  },
  deleteNotebook: async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete notebook",
      message: "Delete this notebook and its sub-notebooks?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteNotebook(id);
    const state = appStore.getState();
    if (state.selectedNotebookId === id) {
      appStore.setState({ selectedNotebookId: null });
    }
    fetchData();
  },
  moveNoteToNotebook: async (noteId: number, notebookId: number | null) => {
    await moveNote(noteId, notebookId);
    const state = appStore.getState();
    if (state.selectedNotebookId !== null && notebookId !== state.selectedNotebookId) {
      if (state.selectedNoteId === noteId) {
        appStore.setState({ selectedNoteId: null });
      }
    }
    fetchData();
  },
  moveNotebookByDrag: async (activeId: number, overId: number, position: "before" | "after" | "inside") => {
    const state = appStore.getState();
    const activeNotebook = state.notebooks.find((nb) => nb.id === activeId);
    const overNotebook = state.notebooks.find((nb) => nb.id === overId);
    if (!activeNotebook || !overNotebook) return;
    const activeType = activeNotebook.notebookType;
    const overType = overNotebook.notebookType;

    if (activeType === "stack") {
      if (overType !== "stack") return;
      const targetParentId = null;
      const siblings = getOrderedChildren(state.notebooks, null).filter((nb) => nb.id !== activeId);
      let targetIndex = siblings.findIndex((nb) => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after" || position === "inside") targetIndex += 1;
      if (isDescendant(state.notebooks, targetParentId, activeId)) return;
      await moveNotebook(activeId, targetParentId, targetIndex);
      fetchData();
      return;
    }

    if (activeType === "notebook") {
      let targetParentId: number | null = null;
      if (overType === "stack") {
        if (position !== "inside") return;
        targetParentId = overNotebook.id;
        const siblings = getOrderedChildren(state.notebooks, targetParentId).filter((nb) => nb.id !== activeId);
        const targetIndex = siblings.length;
        if (isDescendant(state.notebooks, targetParentId, activeId)) return;
        await moveNotebook(activeId, targetParentId, targetIndex);
        fetchData();
        return;
      }

      targetParentId = overNotebook.parentId;
      if (targetParentId === null) return;
      const targetParent = state.notebooks.find((nb) => nb.id === targetParentId);
      if (!targetParent || targetParent.notebookType !== "stack") return;
      const siblings = getOrderedChildren(state.notebooks, targetParentId).filter((nb) => nb.id !== activeId);
      let targetIndex = siblings.findIndex((nb) => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after" || position === "inside") targetIndex += 1;
      if (isDescendant(state.notebooks, targetParentId, activeId)) return;
      await moveNotebook(activeId, targetParentId, targetIndex);
      fetchData();
    }
  },
};

let prevState = appStore.getState();
export const initApp = async () => {
  await loadSettings();
  appStore.setState({ isLoaded: true });
  await fetchData();

  const unlistenView = await listen<string>("notes-list-view", (event) => {
    if (event.payload === "compact" || event.payload === "detailed") {
      appStore.setState({ notesListView: event.payload });
    }
  });

  const unlistenImport = await listen("import-evernote", async () => {
    const selected = await open({
      title: "Import from Evernote",
      filters: [{ name: "Evernote Export", extensions: ["enex"] }],
    });
    if (selected) {
      console.log("Evernote import file selected:", selected);
    }
  });

  const unsubscribe = appStore.subscribe(() => {
    const nextState = appStore.getState();
    if (!nextState.isLoaded) {
      prevState = nextState;
      return;
    }

    if (
      nextState.sidebarWidth !== prevState.sidebarWidth ||
      nextState.listWidth !== prevState.listWidth ||
      nextState.selectedNotebookId !== prevState.selectedNotebookId ||
      nextState.selectedNoteId !== prevState.selectedNoteId ||
      nextState.notesListView !== prevState.notesListView ||
      nextState.notesSortBy !== prevState.notesSortBy ||
      nextState.notesSortDir !== prevState.notesSortDir ||
      nextState.expandedNotebooks !== prevState.expandedNotebooks
    ) {
      persistSettings(nextState);
    }

    if (nextState.selectedNotebookId !== prevState.selectedNotebookId) {
      fetchData();
    }

    if (nextState.searchTerm !== prevState.searchTerm) {
      if (searchTimer !== null) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        fetchData();
      }, 200);
    }

    if (nextState.notesListView !== prevState.notesListView) {
      setNotesListView(nextState.notesListView).catch(() => {});
    }

    if (
      nextState.title !== prevState.title ||
      nextState.content !== prevState.content
    ) {
      scheduleAutosave();
    }

    prevState = nextState;
  });

  return () => {
    unlistenView();
    unlistenImport();
    unsubscribe();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    cleanupSettings();
  };
};
