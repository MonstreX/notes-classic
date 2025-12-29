import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openNotebookDialog, openTagDialog, openConfirmDialog } from "../ui/dialogs";
import type { Notebook, Tag } from "../state/types";
import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { toStorageContent } from "../services/content";
import { cleanupSettings, loadSettings, persistSettings } from "../services/settings";
import {
  createNote,
  createNotebook,
  deleteNotebook,
  deleteNote,
  getNotes,
  moveNotebook,
  moveNote,
  restoreAllNotes,
  restoreNote,
  setNotesListView,
  trashNote,
  updateNote,
} from "../services/notes";
import { addNoteTag, createTag as createTagService, deleteTag as deleteTagService, getNoteTags, getTags, removeNoteTag, updateTagParent } from "../services/tags";
import { loadSelectedNote } from "./noteLoader";
import { fetchNotesData, resortNotes } from "./dataLoader";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");
const buildExcerpt = (value: string) => stripTags(value || "");

const normalizeTagName = (value: string) => value.trim();

const findTagByName = (tags: Tag[], name: string) => {
  const lower = name.toLowerCase();
  return tags.find((tag) => tag.name.toLowerCase() === lower) ?? null;
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

export const actions = {
  setTitle: (value: string) => appStore.setState({ title: value }),
  setContent: (value: string) => appStore.setState({ content: value }),
  selectNote: async (id: number) => {
    const state = appStore.getState();
    if (state.selectedNoteId === id) return;
    appStore.setState({ selectedNoteId: id, isNoteLoading: true });
    await loadSelectedNote();
  },
  selectNotebook: (id: number | null) => appStore.setState({ selectedNotebookId: id, selectedTagId: null, selectedTrash: false }),
  selectTag: (id: number) => appStore.setState({ selectedTagId: id, selectedNotebookId: null, selectedTrash: false }),
  selectTrash: () => appStore.setState({ selectedTrash: true, selectedNotebookId: null, selectedTagId: null }),
  toggleNotebook: (id: number) => {
    const current = appStore.getState().expandedNotebooks;
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    appStore.setState({ expandedNotebooks: next });
  },
  toggleTag: (id: number) => {
    const current = appStore.getState().expandedTags;
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    appStore.setState({ expandedTags: next });
  },
  toggleTagsSection: () => {
    const current = appStore.getState().tagsSectionExpanded;
    appStore.setState({ tagsSectionExpanded: !current });
  },
  setSidebarWidth: (value: number) => appStore.setState({ sidebarWidth: value }),
  setListWidth: (value: number) => appStore.setState({ listWidth: value }),
  setNotesListView: (value: "compact" | "detailed") => appStore.setState({ notesListView: value }),
  setNotesSort: (sortBy: "updated" | "title", sortDir: "asc" | "desc") => {
    resortNotes(sortBy, sortDir);
  },
  setDeleteToTrash: (value: boolean) => appStore.setState({ deleteToTrash: value }),
  addTagToNote: async (name: string) => {
    const state = appStore.getState();
    const noteId = state.selectedNoteId;
    if (!noteId) return;
    const normalized = normalizeTagName(name);
    if (!normalized) return;
    const existing = findTagByName(state.tags, normalized);
    let tagId = existing?.id;
    if (!tagId) {
      tagId = await createTagService(normalized, null);
      appStore.setState({ tags: [...state.tags, { id: tagId, name: normalized, parentId: null }] });
    }
    await addNoteTag(noteId, tagId);
    const updated = await getNoteTags(noteId);
    appStore.setState({ noteTags: updated });
  },
  addTagToNoteById: async (noteId: number, tagId: number) => {
    try {
      await addNoteTag(noteId, tagId);
      const state = appStore.getState();
      if (state.selectedNoteId === noteId) {
        const updated = await getNoteTags(noteId);
        appStore.setState({ noteTags: updated });
      }
    } catch (e) {
      logError("[tag] add failed", e);
    }
  },
  createTag: async (parentId: number | null) => {
    const name = await openTagDialog({ parentId });
    if (!name) return;
    const normalized = normalizeTagName(name);
    if (!normalized) return;
    const id = await createTagService(normalized, parentId);
    const state = appStore.getState();
    appStore.setState({ tags: [...state.tags, { id, name: normalized, parentId }] });
    if (parentId !== null) {
      const next = new Set(state.expandedTags);
      next.add(parentId);
      appStore.setState({ expandedTags: next });
    }
  },
  deleteTag: async (id: number) => {
    const ok = await openConfirmDialog({
      title: "Delete tag",
      message: "Are you sure you want to delete this tag and its children?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTagService(id);
      const tags = await getTags();
      const state = appStore.getState();
      const nextSelectedTagId = state.selectedTagId === id ? null : state.selectedTagId;
      const nextExpandedTags = new Set(
        Array.from(state.expandedTags).filter((tagId) => tagId !== id)
      );
      appStore.setState({ tags, selectedTagId: nextSelectedTagId, expandedTags: nextExpandedTags });
      if (state.selectedTagId === id) {
        fetchData();
      }
    } catch (e) {
      logError("[tag] delete failed", e);
    }
  },
  moveTag: async (tagId: number, parentId: number | null) => {
    const state = appStore.getState();
    if (tagId === parentId) return;
    if (isTagDescendant(state.tags, parentId, tagId)) return;
    await updateTagParent(tagId, parentId);
    const tags = await getTags();
    const nextExpandedTags = new Set(state.expandedTags);
    if (parentId !== null) nextExpandedTags.add(parentId);
    appStore.setState({ tags, expandedTags: nextExpandedTags });
  },
  removeTagFromNote: async (tagId: number) => {
    const state = appStore.getState();
    const noteId = state.selectedNoteId;
    if (!noteId) return;
    try {
      await removeNoteTag(noteId, tagId);
      const updated = await getNoteTags(noteId);
      appStore.setState({ noteTags: updated });
    } catch (e) {
      logError("[tag] remove failed", e);
    }
  },
  createNote: async () => {
    const state = appStore.getState();
    if (state.selectedTrash) {
      appStore.setState({ selectedTrash: false, selectedNotebookId: null, selectedTagId: null });
    }
    const id = await createNote("New Note", "", state.selectedNotebookId);
    await fetchData();
    await actions.selectNote(id);
  },
  createNoteInNotebook: async (notebookId: number) => {
    appStore.setState({ selectedNotebookId: notebookId, selectedTrash: false });
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
    if (!state.deleteToTrash || state.selectedTrash) {
      await actions.purgeNote(id);
      return;
    }
    try {
      await trashNote(id);
    } catch (e) {
      logError("[note] trash failed", e);
      return;
    }
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
  purgeNote: async (id: number) => {
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
  restoreNote: async (id: number) => {
    try {
      await restoreNote(id);
    } catch (e) {
      logError("[note] restore failed", e);
      return;
    }
    const state = appStore.getState();
    if (state.selectedTrash) {
      const nextNotes = state.notes.filter((note) => note.id !== id);
      const nextSelected = nextNotes[0]?.id ?? null;
      appStore.setState({ notes: nextNotes, selectedNoteId: nextSelected });
    }
    fetchData();
  },
  restoreAllTrash: async () => {
    try {
      await restoreAllNotes();
    } catch (e) {
      logError("[note] restore all failed", e);
      return;
    }
    if (appStore.getState().selectedTrash) {
      appStore.setState({ notes: [], selectedNoteId: null });
    }
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

const isTagDescendant = (tags: Tag[], candidateParentId: number | null, tagId: number) => {
  if (candidateParentId === null) return false;
  const parentMap = new Map<number, number | null>();
  tags.forEach((tag) => parentMap.set(tag.id, tag.parentId));
  let current = candidateParentId;
  while (current !== null) {
    if (current === tagId) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
};
