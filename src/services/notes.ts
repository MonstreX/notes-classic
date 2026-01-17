import { invoke } from "@tauri-apps/api/core";
import type { NoteCounts, NoteDetail, NoteLinkItem, NoteListItem, Notebook } from "../state/types";

export const getNotebooks = () => invoke<Notebook[]>("get_notebooks");

export const getNotes = (notebookId: number | null) =>
  invoke<NoteListItem[]>("get_notes", { notebookId });

export const getTrashedNotes = () =>
  invoke<NoteListItem[]>("get_trashed_notes");

export const getNotesByTag = (tagId: number) =>
  invoke<NoteListItem[]>("get_notes_by_tag", { tagId });

export const searchNotes = (query: string, notebookId: number | null) =>
  invoke<NoteListItem[]>("search_notes", { query, notebookId });

export const getNote = (id: number) => invoke<NoteDetail | null>("get_note", { id });

export const getNoteCounts = () => invoke<NoteCounts>("get_note_counts");

export const searchNotesByTitle = (query: string, limit = 20) =>
  invoke<NoteLinkItem[]>("search_notes_by_title", { query, limit });

export const getNoteIdByExternalId = (externalId: string) =>
  invoke<number | null>("get_note_id_by_external_id", { externalId });

export const createNote = (title: string, content: string, notebookId: number | null) =>
  invoke<number>("upsert_note", { id: null, title, content, notebookId });

export const updateNote = (id: number, title: string, content: string, notebookId: number | null) =>
  invoke("upsert_note", { id, title, content, notebookId });

export const setNotesListView = (view: "compact" | "detailed") =>
  invoke("set_notes_list_view", { view });

export const deleteNote = (id: number) => invoke("delete_note", { id });

export const trashNote = (id: number) => invoke("trash_note", { id });

export const restoreNote = (id: number) => invoke("restore_note", { id });

export const restoreAllNotes = () => invoke("restore_all_notes");

export const moveNote = (noteId: number, notebookId: number | null) =>
  invoke("move_note", { noteId, notebookId });

export const createNotebook = (name: string, parentId: number | null) =>
  invoke<number>("create_notebook", { name, parentId });

export const deleteNotebook = (id: number) => invoke("delete_notebook", { id });

export const renameNotebook = (id: number, name: string) =>
  invoke("rename_notebook", { id, name });

export const moveNotebook = (notebookId: number, parentId: number | null, index: number) =>
  invoke("move_notebook", { notebookId, parentId, index });
