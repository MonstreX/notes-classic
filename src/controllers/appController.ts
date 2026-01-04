import { listen } from "@tauri-apps/api/event";
import { openConfirmDialog } from "../ui/dialogs";
import { t } from "../services/i18n";
import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { toStorageContent } from "../services/content";
import { cleanupSettings, loadSettings, persistSettings } from "../services/settings";
import {
  getNote,
  getNoteIdByExternalId,
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

const HISTORY_LIMIT = 200;

const recordHistory = (noteId: number) => {
  const state = appStore.getState();
  if (state.historyCurrent === noteId) return;
  const nextBack = [...state.historyBack];
  if (state.historyCurrent !== null) {
    nextBack.push(state.historyCurrent);
  }
  if (nextBack.length > HISTORY_LIMIT) {
    nextBack.splice(0, nextBack.length - HISTORY_LIMIT);
  }
  appStore.setState({
    historyBack: nextBack,
    historyForward: [],
    historyCurrent: noteId,
  });
};

const openNoteInternal = async (noteId: number, record: boolean) => {
  const note = await getNote(noteId);
  if (!note) return;
  if (record) {
    recordHistory(noteId);
  } else {
    appStore.setState({ historyCurrent: noteId });
  }
  appStore.setState({ selectedNotebookId: note.notebookId, selectedTagId: null, selectedTrash: false });
  await fetchData(true);
  await selectionActions.selectNote(noteId);
};

const goBack = async () => {
  const state = appStore.getState();
  if (state.historyBack.length === 0) return;
  const nextBack = [...state.historyBack];
  const target = nextBack.pop();
  if (!target) return;
  const nextForward = state.historyCurrent !== null
    ? [state.historyCurrent, ...state.historyForward]
    : [...state.historyForward];
  appStore.setState({ historyBack: nextBack, historyForward: nextForward, historyCurrent: target });
  await openNoteInternal(target, false);
};

const goForward = async () => {
  const state = appStore.getState();
  if (state.historyForward.length === 0) return;
  const nextForward = [...state.historyForward];
  const target = nextForward.shift();
  if (!target) return;
  const nextBack = state.historyCurrent !== null
    ? [...state.historyBack, state.historyCurrent]
    : [...state.historyBack];
  appStore.setState({ historyBack: nextBack, historyForward: nextForward, historyCurrent: target });
  await openNoteInternal(target, false);
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
const noteActions = createNoteActions(fetchData, (id) => openNoteInternal(id, true));
const notebookActions = createNotebookActions(fetchData);

export const actions = {
  ...selectionActions,
  ...noteActions,
  ...tagActions,
  ...notebookActions,
  openNote: async (id: number) => openNoteInternal(id, true),
  setNoteSelectionWithHistory: async (ids: number[], primaryId: number) => {
    recordHistory(primaryId);
    await selectionActions.setNoteSelection(ids, primaryId);
  },
  goBack,
  goForward,
  openNoteByLink: async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    const noteId = /^\d+$/.test(trimmed)
      ? Number(trimmed)
      : await getNoteIdByExternalId(trimmed);
    if (!noteId) return;
    await openNoteInternal(noteId, true);
  },
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
        title: t("dialog.no_stack_title"),
        message: t("dialog.no_stack_message"),
        confirmLabel: t("dialog.create_stack"),
        cancelLabel: t("dialog.cancel"),
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
      nextState.tagsSectionExpanded !== prevState.tagsSectionExpanded ||
      nextState.deleteToTrash !== prevState.deleteToTrash ||
      nextState.language !== prevState.language
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
    unlistenMenuNewNote();
    unlistenMenuDeleteNote();
    unlistenMenuNewStack();
    unlistenMenuNewNotebook();
    unsubscribe();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    cleanupSettings();
  };
};

