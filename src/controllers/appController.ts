import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openConfirmDialog } from "../ui/dialogs";
import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { toStorageContent } from "../services/content";
import { cleanupSettings, loadSettings, persistSettings } from "../services/settings";
import {
  setNotesListView,
  updateNote,
} from "../services/notes";
import { getTags } from "../services/tags";
import { loadSelectedNote } from "./noteLoader";
import { fetchNotesData, resortNotes } from "./dataLoader";
import { selectionActions } from "./selectionController";
import { createTagActions } from "./tagController";
import { createNoteActions } from "./noteController";
import { createNotebookActions } from "./notebookController";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");
const buildExcerpt = (value: string) => stripTags(value || "");

const fetchData = async (force = false) => {
  try {
    const result = await fetchNotesData(force);
    if (!result) return;
    const { selectionChanged, nextSelectedNoteId } = result;
    const state = appStore.getState();
    if (nextSelectedNoteId !== null && (selectionChanged || state.activeNote?.id !== nextSelectedNoteId)) {
      await loadSelectedNote();
    }
  } catch (err) {
    logError("[fetch] failed", err);
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
      try {
        const storageContent = toStorageContent(state.content);
        await updateNote(state.selectedNoteId, state.title, storageContent, currentNote.notebookId);
        const updatedAt = Date.now() / 1000;
        const excerpt = buildExcerpt(state.content);
        appStore.setState({
          activeNote: { ...currentNote, title: state.title, content: state.content, updatedAt },
          notes: state.notes.map((n) => n.id === state.selectedNoteId ? { ...n, title: state.title, content: state.content, excerpt, updatedAt } : n),
        });
      } catch (err) {
        logError("[autosave] failed", err);
      }
    }
  }, 1000);
};

const tagActions = createTagActions(fetchData);
const noteActions = createNoteActions(fetchData, selectionActions.selectNote);
const notebookActions = createNotebookActions(fetchData);

export const actions = {
  ...selectionActions,
  ...noteActions,
  ...tagActions,
  ...notebookActions,
  setNotesSort: (sortBy: "updated" | "title", sortDir: "asc" | "desc") => {
    resortNotes(sortBy, sortDir);
  },
};

let prevState = appStore.getState();
export const initApp = async () => {
  appStore.setState({ isLoaded: false });
  await loadSettings();
  try {
    await fetchData(true);
    const tags = await getTags();
    appStore.setState({ tags });
  } catch (e) {
    logError("[init] load failed", e);
  } finally {
    appStore.setState({ isLoaded: true });
  }

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

  const unlistenMenuNewNote = await listen("menu-new-note", () => {
    actions.createNote();
  });
  const unlistenMenuDeleteNote = await listen("menu-delete-note", () => {
    const state = appStore.getState();
    const ids = state.selectedNoteIds.size
      ? Array.from(state.selectedNoteIds)
      : (state.selectedNoteId ? [state.selectedNoteId] : []);
    if (!ids.length) return;
    actions.deleteNotes(ids);
  });
  const unlistenMenuNewStack = await listen("menu-new-stack", () => {
    actions.createNotebook(null);
  });
  const unlistenMenuNewNotebook = await listen("menu-new-notebook", async () => {
    const state = appStore.getState();
    const stacks = state.notebooks.filter((nb) => nb.notebookType === "stack");
    if (!stacks.length) {
      const ok = await openConfirmDialog({
        title: "No stack selected",
        message: "Create a notebook stack first.",
        confirmLabel: "Create stack",
        cancelLabel: "Cancel",
      });
      if (ok) {
        actions.createNotebook(null);
      }
      return;
    }
    const selected = state.notebooks.find((nb) => nb.id === state.selectedNotebookId);
    let parentId = selected?.notebookType === "stack" ? selected.id : selected?.parentId || null;
    if (!parentId) {
      parentId = stacks[0]?.id ?? null;
    }
    if (!parentId) return;
    actions.createNotebook(parentId);
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
      nextState.selectedTagId !== prevState.selectedTagId ||
      nextState.selectedNoteId !== prevState.selectedNoteId ||
      nextState.notesListView !== prevState.notesListView ||
      nextState.notesSortBy !== prevState.notesSortBy ||
      nextState.notesSortDir !== prevState.notesSortDir ||
      nextState.expandedNotebooks !== prevState.expandedNotebooks ||
      nextState.expandedTags !== prevState.expandedTags ||
      nextState.tagsSectionExpanded !== prevState.tagsSectionExpanded
    ) {
      persistSettings(nextState);
    }

    if (
      nextState.selectedNotebookId !== prevState.selectedNotebookId ||
      nextState.selectedTagId !== prevState.selectedTagId
    ) {
      fetchData();
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
    unlistenMenuNewNote();
    unlistenMenuDeleteNote();
    unlistenMenuNewStack();
    unlistenMenuNewNotebook();
    unsubscribe();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    cleanupSettings();
  };
};

