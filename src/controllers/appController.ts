import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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

const fetchData = async () => {
  try {
    const result = await fetchNotesData();
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
  await loadSettings();
  appStore.setState({ isLoaded: true });
  await fetchData();
  try {
    const tags = await getTags();
    appStore.setState({ tags });
  } catch (e) {
    logError("[tag] list failed", e);
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
    unsubscribe();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    cleanupSettings();
  };
};

