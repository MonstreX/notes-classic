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

const setSelection = async (noteIds: number[], primaryId: number | null) => {
  const unique = Array.from(new Set(noteIds));
  const nextPrimary = primaryId !== null && unique.includes(primaryId)
    ? primaryId
    : (unique[0] ?? null);
  const nextSelectedIds = new Set(unique);
  if (nextPrimary !== null) {
    nextSelectedIds.add(nextPrimary);
  }
  const state = appStore.getState();
  if (state.selectedNoteId !== nextPrimary) {
    appStore.setState({ selectedNoteId: nextPrimary, selectedNoteIds: nextSelectedIds, isNoteLoading: nextPrimary !== null });
    if (nextPrimary !== null) {
      await loadSelectedNote();
    } else {
      appStore.setState({ activeNote: null, title: "", content: "", isNoteLoading: false });
    }
    return;
  }
  appStore.setState({ selectedNoteIds: nextSelectedIds });
};

export const actions = {
  setTitle: (value: string) => appStore.setState({ title: value }),
  setContent: (value: string) => appStore.setState({ content: value }),
  selectNote: async (id: number) => {
    await setSelection([id], id);
  },
  setNoteSelection: async (ids: number[], primaryId: number) => {
    await setSelection(ids, primaryId);
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
    await actions.deleteNotes([id]);
  },
  deleteNotes: async (ids: number[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
    if (unique.length === 0) return;
    const prevSelectedId = appStore.getState().selectedNoteId;
    const countLabel = unique.length === 1 ? "note" : "notes";
    const state = appStore.getState();
    const inTrash = state.selectedTrash;
    const bypassTrash = !state.deleteToTrash || inTrash;
    const title = unique.length === 1 ? "Delete note" : "Delete notes";
    const message = inTrash
      ? `Delete ${unique.length} ${countLabel} permanently?`
      : `Delete ${unique.length} ${countLabel}?`;
    const ok = await openConfirmDialog({
      title,
      message,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    if (bypassTrash) {
      for (const id of unique) {
        try {
          await deleteNote(id);
        } catch (e) {
          logError("[note] delete failed", e);
        }
      }
    } else {
      for (const id of unique) {
        try {
          await trashNote(id);
        } catch (e) {
          logError("[note] trash failed", e);
        }
      }
    }

    const idsSet = new Set(unique);
    const remainingNotes = state.notes.filter((note) => !idsSet.has(note.id));
    const remainingSelectedIds = new Set(Array.from(state.selectedNoteIds).filter((id) => !idsSet.has(id)));
    let nextSelectedNoteId = state.selectedNoteId;
    if (nextSelectedNoteId !== null && idsSet.has(nextSelectedNoteId)) {
      nextSelectedNoteId = remainingNotes[0]?.id ?? null;
    }
    if (nextSelectedNoteId !== null) {
      remainingSelectedIds.add(nextSelectedNoteId);
    } else {
      remainingSelectedIds.clear();
    }
    const nextState: Partial<typeof state> = {
      notes: remainingNotes,
      selectedNoteId: nextSelectedNoteId,
      selectedNoteIds: remainingSelectedIds,
    };
    if (nextSelectedNoteId === null) {
      nextState.activeNote = null;
      nextState.title = "";
      nextState.content = "";
    } else {
      nextState.isNoteLoading = true;
    }
    appStore.setState(nextState);
    if (nextSelectedNoteId !== null && nextSelectedNoteId !== prevSelectedId) {
      await loadSelectedNote();
    }
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
  restoreNotes: async (ids: number[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
    if (unique.length === 0) return;
    for (const id of unique) {
      try {
        await restoreNote(id);
      } catch (e) {
        logError("[note] restore failed", e);
      }
    }
    const state = appStore.getState();
    if (state.selectedTrash) {
      const idsSet = new Set(unique);
      const nextNotes = state.notes.filter((note) => !idsSet.has(note.id));
      const nextSelected = nextNotes[0]?.id ?? null;
      appStore.setState({ notes: nextNotes, selectedNoteId: nextSelected, selectedNoteIds: nextSelected ? new Set([nextSelected]) : new Set() });
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
  moveNotesToNotebook: async (noteIds: number[], notebookId: number | null) => {
    const unique = Array.from(new Set(noteIds)).filter((id) => Number.isFinite(id));
    for (const id of unique) {
      await moveNote(id, notebookId);
    }
    fetchData();
  },
  addTagToNotes: async (noteIds: number[], tagId: number) => {
    const unique = Array.from(new Set(noteIds)).filter((id) => Number.isFinite(id));
    for (const id of unique) {
      try {
        await addNoteTag(id, tagId);
      } catch (e) {
        logError("[tag] add failed", e);
      }
    }
    const state = appStore.getState();
    if (state.selectedNoteId && unique.includes(state.selectedNoteId)) {
      const updated = await getNoteTags(state.selectedNoteId);
      appStore.setState({ noteTags: updated });
    }
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
