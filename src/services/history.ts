import { invoke } from "@tauri-apps/api/core";

export type NoteHistoryItem = {
  id: number;
  noteId: number;
  openedAt: number;
  noteTitle: string;
  notebookId: number | null;
  notebookName: string | null;
  stackId: number | null;
  stackName: string | null;
};

export const addHistoryEntry = (noteId: number, minGapSeconds = 5) =>
  invoke("add_history_entry", { noteId, minGapSeconds });

export const getNoteHistory = (limit = 500, offset = 0) =>
  invoke<NoteHistoryItem[]>("get_note_history", { limit, offset });

export const clearNoteHistory = () =>
  invoke("clear_note_history");

export const cleanupNoteHistory = (days: number) =>
  invoke("cleanup_note_history", { days });
