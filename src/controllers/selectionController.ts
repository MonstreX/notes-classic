import { appStore } from "../state/store";
import { loadSelectedNote } from "./noteLoader";

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

export const selectionActions = {
  selectNote: async (id: number) => {
    await setSelection([id], id);
  },
  setNoteSelection: async (ids: number[], primaryId: number) => {
    await setSelection(ids, primaryId);
  },
  selectNotebook: (id: number | null) =>
    appStore.setState({ selectedNotebookId: id, selectedTagId: null, selectedTrash: false }),
  selectTag: (id: number) =>
    appStore.setState({ selectedTagId: id, selectedNotebookId: null, selectedTrash: false }),
  selectTrash: () =>
    appStore.setState({ selectedTrash: true, selectedNotebookId: null, selectedTagId: null }),
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
  setDeleteToTrash: (value: boolean) => appStore.setState({ deleteToTrash: value }),
};
