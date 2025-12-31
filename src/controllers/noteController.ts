import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { openConfirmDialog } from "../ui/dialogs";
import { createNote, deleteNote, moveNote, restoreAllNotes, restoreNote, trashNote } from "../services/notes";
import { loadSelectedNote } from "./noteLoader";

export const createNoteActions = (fetchData: () => Promise<void>, selectNote: (id: number) => Promise<void>) => {
  const deleteNotesInternal = async (ids: number[]) => {
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
    fetchData();
  };

  return {
    setTitle: (value: string) => appStore.setState({ title: value }),
    setContent: (value: string) => appStore.setState({ content: value }),
    createNote: async () => {
      const state = appStore.getState();
      if (state.selectedTrash) {
        appStore.setState({ selectedTrash: false, selectedNotebookId: null, selectedTagId: null });
      }
      const id = await createNote("New Note", "", state.selectedNotebookId);
      await fetchData();
      await selectNote(id);
    },
    createNoteInNotebook: async (notebookId: number) => {
      appStore.setState({ selectedNotebookId: notebookId, selectedTrash: false });
      const id = await createNote("New Note", "", notebookId);
      await fetchData();
      await selectNote(id);
    },
    deleteNote: async (id: number) => {
      await deleteNotesInternal([id]);
    },
    deleteNotes: deleteNotesInternal,
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
  };
};
