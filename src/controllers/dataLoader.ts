import { appStore } from "../state/store";
import type { NoteListItem } from "../state/types";
import { getNoteCounts, getNotes, getNotesByTag, getNotebooks, getTrashedNotes } from "../services/notes";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");
const buildExcerpt = (value: string) => stripTags(value || "");

const sortNotes = (
  notes: NoteListItem[],
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

export const fetchNotesData = async (force = false) => {
  const state = appStore.getState();
  if (!state.isLoaded && !force) return;
  const notesPromise = state.selectedTrash
    ? getTrashedNotes()
    : state.selectedTagId !== null
      ? getNotesByTag(state.selectedTagId)
      : getNotes(state.selectedNotebookId);
  const [nbs, filteredNotes, counts] = await Promise.all([
    getNotebooks(),
    notesPromise,
    getNoteCounts(),
  ]);
  const latestState = appStore.getState();
  if (
    latestState.selectedTrash !== state.selectedTrash ||
    latestState.selectedTagId !== state.selectedTagId ||
    latestState.selectedNotebookId !== state.selectedNotebookId
  ) {
    return;
  }
  const notesWithExcerpt = filteredNotes.map((note) => ({
    ...note,
    excerpt: buildExcerpt(note.content || ""),
  }));
  const sortedNotes = latestState.selectedTrash
    ? notesWithExcerpt
    : sortNotes(notesWithExcerpt, latestState.notesSortBy, latestState.notesSortDir);
  const map = new Map<number, number>();
  counts.perNotebook.forEach((item) => {
    map.set(item.notebookId, item.count);
  });
  const noteIds = new Set(sortedNotes.map((note) => note.id));
  const preservedSelection = new Set(
    Array.from(latestState.selectedNoteIds).filter((id) => noteIds.has(id))
  );
  let nextSelectedNoteId = latestState.selectedNoteId;
  const hasSelected = nextSelectedNoteId !== null && noteIds.has(nextSelectedNoteId);
  if (latestState.selectedTrash || latestState.selectedTagId !== null || latestState.selectedNotebookId !== null) {
    nextSelectedNoteId = hasSelected
      ? nextSelectedNoteId
      : preservedSelection.size > 0
        ? Array.from(preservedSelection)[0]
        : (sortedNotes[0]?.id ?? null);
  }
  const selectionChanged = nextSelectedNoteId !== latestState.selectedNoteId;
  if (nextSelectedNoteId !== null) {
    preservedSelection.add(nextSelectedNoteId);
  } else {
    preservedSelection.clear();
  }
  const nextState: Partial<typeof state> = {
    notebooks: nbs,
    notes: sortedNotes,
    noteCounts: map,
    totalNotes: counts.total,
    trashedCount: counts.trashed,
    selectedNoteId: nextSelectedNoteId,
    selectedNoteIds: preservedSelection,
  };
  if (selectionChanged && nextSelectedNoteId !== null) {
    nextState.isNoteLoading = true;
  }
  appStore.setState(nextState);
  return { selectionChanged, nextSelectedNoteId };
};

export const resortNotes = (sortBy: "updated" | "title", sortDir: "asc" | "desc") => {
  const state = appStore.getState();
  const sorted = sortNotes(state.notes, sortBy, sortDir);
  appStore.setState({ notesSortBy: sortBy, notesSortDir: sortDir, notes: sorted });
};
