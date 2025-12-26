import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/dialog";
import { openNotebookDialog, openConfirmDialog } from "./dialogs";
import type { Notebook, NoteListItem, NoteDetail, NoteCounts } from "./types";
import { appStore } from "./store";

const STORAGE_KEY = "notes_classic_v10_stable";

const imageSrcMap = new Map<string, string>();
const dataFileCache = new Map<string, string>();

const normalizeEnmlContent = (raw: string) => {
  if (!raw) return raw;
  let out = raw.replace(/<en-note[^>]*>/gi, "<div>");
  out = out.replace(/<\/en-note>/gi, "</div>");
  out = out.replace(/<br><\/br>/gi, "<br>");
  return out;
};

const ensureNotesScheme = (raw: string) => {
  if (!raw) return raw;
  if (raw.includes("notes-file://")) return raw;
  return raw
    .replace(/src=\"files\//g, 'src="notes-file://files/')
    .replace(/src='files\//g, "src='notes-file://files/");
};

const toDisplayContent = async (raw: string) => {
  if (!raw) return raw;
  const matches = Array.from(raw.matchAll(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g));
  if (matches.length === 0) return raw;

  const uniqueRel = Array.from(new Set(matches.map((m) => m[2])));
  const resolved = new Map<string, string>();
  await Promise.all(
    uniqueRel.map(async (rel) => {
      const cached = dataFileCache.get(rel);
      if (cached) {
        resolved.set(rel, cached);
        return;
      }
      try {
        const dataUrl = await invoke<string>("read_data_file", { path: `files/${rel}` });
        resolved.set(rel, dataUrl);
        dataFileCache.set(rel, dataUrl);
        imageSrcMap.set(dataUrl, `notes-file://files/${rel}`);
      } catch (e) {}
    })
  );

  return raw.replace(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, rel) => {
    const dataUrl = resolved.get(rel);
    if (!dataUrl) return match;
    return `src=${quote}${dataUrl}${quote}`;
  });
};

const toStorageContent = (raw: string) => {
  if (!raw) return raw;
  const normalized = raw.replace(/src=(\"|')(asset|tauri):\/\/[^\"']*?\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, _scheme, rel) => {
    return `src=${quote}notes-file://files/${rel}${quote}`;
  });
  return normalized.replace(/src=(\"|')(data:[^\"']+)\1/g, (match, quote, dataUrl) => {
    const original = imageSrcMap.get(dataUrl);
    if (!original) return match;
    return `src=${quote}${original}${quote}`;
  });
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
    const [nbs, filteredNotes, counts] = await Promise.all([
      invoke<Notebook[]>("get_notebooks"),
      invoke<NoteListItem[]>("get_notes", { notebookId: state.selectedNotebookId }),
      invoke<NoteCounts>("get_note_counts"),
    ]);
    const map = new Map<number, number>();
    counts.perNotebook.forEach((item) => {
      map.set(item.notebookId, item.count);
    });
    appStore.setState({
      notebooks: nbs,
      notes: filteredNotes,
      noteCounts: map,
      totalNotes: counts.total,
    });
  } catch (err) {
    console.error("Fetch Error:", err);
  }
};

const loadSelectedNote = async () => {
  const state = appStore.getState();
  if (!state.selectedNoteId) {
    appStore.setState({ activeNote: null, title: "", content: "" });
    return;
  }
  try {
    const note = await invoke<NoteDetail | null>("get_note", { id: state.selectedNoteId });
    if (!note) {
      appStore.setState({ activeNote: null, title: "", content: "" });
      return;
    }
    const normalized = ensureNotesScheme(normalizeEnmlContent(note.content));
    try {
      const displayContent = await toDisplayContent(normalized);
      const finalNote = displayContent !== note.content ? { ...note, content: displayContent } : note;
      appStore.setState({ activeNote: finalNote, title: finalNote.title, content: finalNote.content });
    } catch (e) {
      appStore.setState({ activeNote: note, title: note.title, content: note.content });
    }
  } catch (e) {}
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
      await invoke("upsert_note", { id: state.selectedNoteId, title: state.title, content: storageContent, notebookId: currentNote.notebookId });
      const updatedAt = Date.now() / 1000;
      appStore.setState({
        activeNote: { ...currentNote, title: state.title, content: state.content, updatedAt },
        notes: state.notes.map((n) => n.id === state.selectedNoteId ? { ...n, title: state.title, content: state.content, updatedAt } : n),
      });
    }
  }, 1000);
};

export const actions = {
  setSearchTerm: (value: string) => appStore.setState({ searchTerm: value }),
  setTitle: (value: string) => appStore.setState({ title: value }),
  setContent: (value: string) => appStore.setState({ content: value }),
  selectNote: (id: number) => appStore.setState({ selectedNoteId: id }),
  selectNotebook: (id: number | null) => appStore.setState({ selectedNotebookId: id }),
  toggleNotebook: (id: number) => {
    const current = appStore.getState().expandedNotebooks;
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    appStore.setState({ expandedNotebooks: next });
  },
  setSidebarWidth: (value: number) => appStore.setState({ sidebarWidth: value }),
  setListWidth: (value: number) => appStore.setState({ listWidth: value }),
  createNote: async () => {
    const state = appStore.getState();
    const id = await invoke<number>("upsert_note", { id: null, title: "New Note", content: "", notebookId: state.selectedNotebookId });
    await fetchData();
    appStore.setState({ selectedNoteId: id });
  },
  deleteNote: async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete note",
      message: "Are you sure you want to delete this note?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await invoke("delete_note", { id });
    const state = appStore.getState();
    if (state.selectedNoteId === id) {
      appStore.setState({ selectedNoteId: null });
    }
    fetchData();
  },
  createNotebook: async (parentId: number | null) => {
    const name = await openNotebookDialog({ parentId });
    if (!name) return;
    await invoke("create_notebook", { name, parentId });
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
    await invoke("delete_notebook", { id });
    const state = appStore.getState();
    if (state.selectedNotebookId === id) {
      appStore.setState({ selectedNotebookId: null });
    }
    fetchData();
  },
  moveNoteToNotebook: async (noteId: number, notebookId: number | null) => {
    await invoke("move_note", { noteId, notebookId });
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
      await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
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
        await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
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
      await invoke("move_notebook", { notebookId: activeId, parentId: targetParentId, index: targetIndex });
      fetchData();
    }
  },
};

let prevState = appStore.getState();
let saveSettingsTimer: number | null = null;

const persistSettings = (state: ReturnType<typeof appStore.getState>) => {
  if (saveSettingsTimer !== null) window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(() => {
    const payload = {
      sidebarWidth: state.sidebarWidth,
      listWidth: state.listWidth,
      selectedNotebookId: state.selectedNotebookId,
      selectedNoteId: state.selectedNoteId,
      expandedNotebooks: Array.from(state.expandedNotebooks),
      notesListView: state.notesListView,
    };
    invoke("set_settings", { settings: payload }).catch(() => {});
  }, 200);
};

export const initApp = async () => {
  const loadSettings = async () => {
    try {
      const stored = await invoke<any>("get_settings");
      if (stored) {
        appStore.update((draft) => {
          if (stored.sidebarWidth) draft.sidebarWidth = stored.sidebarWidth;
          if (stored.listWidth) draft.listWidth = stored.listWidth;
          if (stored.selectedNotebookId !== undefined) {
            const parsed = stored.selectedNotebookId === null ? null : Number(stored.selectedNotebookId);
            draft.selectedNotebookId = Number.isFinite(parsed as number) ? (parsed as number) : null;
          }
          if (stored.selectedNoteId !== undefined) {
            const parsed = stored.selectedNoteId === null ? null : Number(stored.selectedNoteId);
            draft.selectedNoteId = Number.isFinite(parsed as number) ? (parsed as number) : null;
          }
          if (stored.expandedNotebooks) {
            const ids = Array.isArray(stored.expandedNotebooks)
              ? stored.expandedNotebooks.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
              : [];
            draft.expandedNotebooks = new Set(ids);
          }
          if (stored.notesListView === "compact" || stored.notesListView === "detailed") {
            draft.notesListView = stored.notesListView;
          }
        });
      } else {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const p = JSON.parse(saved);
            appStore.update((draft) => {
              if (p.sidebarWidth) draft.sidebarWidth = p.sidebarWidth;
              if (p.listWidth) draft.listWidth = p.listWidth;
              if (p.selectedNotebookId !== undefined) {
                const parsed = p.selectedNotebookId === null ? null : Number(p.selectedNotebookId);
                draft.selectedNotebookId = Number.isFinite(parsed as number) ? (parsed as number) : null;
              }
              if (p.selectedNoteId !== undefined) {
                const parsed = p.selectedNoteId === null ? null : Number(p.selectedNoteId);
                draft.selectedNoteId = Number.isFinite(parsed as number) ? (parsed as number) : null;
              }
              if (p.expandedNotebooks) {
                const ids = Array.isArray(p.expandedNotebooks)
                  ? p.expandedNotebooks.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
                  : [];
                draft.expandedNotebooks = new Set(ids);
              }
              if (p.notesListView === "compact" || p.notesListView === "detailed") {
                draft.notesListView = p.notesListView;
              }
            });
            await invoke("set_settings", { settings: p });
            localStorage.removeItem(STORAGE_KEY);
          } catch (e) {}
        }
      }
    } catch (e) {}
    appStore.setState({ isLoaded: true });
  };

  await loadSettings();
  await fetchData();
  await loadSelectedNote();

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
      nextState.expandedNotebooks !== prevState.expandedNotebooks
    ) {
      persistSettings(nextState);
    }

    if (nextState.selectedNotebookId !== prevState.selectedNotebookId) {
      fetchData();
    }

    if (nextState.selectedNoteId !== prevState.selectedNoteId) {
      loadSelectedNote();
    }

    if (nextState.notesListView !== prevState.notesListView) {
      invoke("set_notes_list_view", { view: nextState.notesListView }).catch(() => {});
    }

    if (
      nextState.title !== prevState.title ||
      nextState.content !== prevState.content ||
      nextState.selectedNoteId !== prevState.selectedNoteId
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
    if (saveSettingsTimer !== null) window.clearTimeout(saveSettingsTimer);
  };
};
