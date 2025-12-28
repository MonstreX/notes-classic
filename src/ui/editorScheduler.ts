import type { EditorInstance } from "./editor";

type SchedulerOptions = {
  editor: EditorInstance;
  getSelectedNoteId: () => number | null;
};

export type EditorScheduler = {
  schedule: (noteId: number | null, content: string) => void;
  getLastRenderedNoteId: () => number | null;
  getLastRenderedContent: () => string;
  isUpdating: () => boolean;
  reset: () => void;
};

export const createEditorScheduler = ({ editor, getSelectedNoteId }: SchedulerOptions): EditorScheduler => {
  let pendingUpdate: number | null = null;
  let pendingNoteId: number | null = null;
  let pendingContent = "";
  let updating = false;
  let lastRenderedNoteId: number | null = null;
  let lastRenderedContent = "";

  const clearPending = () => {
    if (pendingUpdate !== null) {
      window.clearTimeout(pendingUpdate);
      pendingUpdate = null;
    }
  };

  const schedule = (noteId: number | null, content: string) => {
    clearPending();
    pendingNoteId = noteId;
    pendingContent = content;
    updating = true;
    pendingUpdate = window.setTimeout(() => {
      pendingUpdate = null;
      const selectedNoteId = getSelectedNoteId();
      if (selectedNoteId !== pendingNoteId) {
        updating = false;
        return;
      }
      try {
        editor.update(pendingContent);
        lastRenderedNoteId = pendingNoteId;
        lastRenderedContent = pendingContent;
      } catch (e) {
        console.error("[editor] update failed", e);
      } finally {
        updating = false;
      }
    }, 0);
  };

  const reset = () => {
    clearPending();
    updating = false;
    pendingNoteId = null;
    pendingContent = "";
    lastRenderedNoteId = null;
    lastRenderedContent = "";
  };

  return {
    schedule,
    getLastRenderedNoteId: () => lastRenderedNoteId,
    getLastRenderedContent: () => lastRenderedContent,
    isUpdating: () => updating,
    reset,
  };
};
