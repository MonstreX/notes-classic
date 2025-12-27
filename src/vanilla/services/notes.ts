import { invoke } from "@tauri-apps/api/core";
import type { NoteCounts, NoteDetail, NoteListItem, Notebook } from "../types";

export const getNotebooks = () => invoke<Notebook[]>("get_notebooks");

export const getNotes = (notebookId: number | null) =>
  invoke<NoteListItem[]>("get_notes", { notebookId });

export const getNote = (id: number) => invoke<NoteDetail | null>("get_note", { id });

export const getNoteCounts = () => invoke<NoteCounts>("get_note_counts");

export const createNote = (title: string, content: string, notebookId: number | null) =>
  invoke<number>("upsert_note", { id: null, title, content, notebookId });

export const updateNote = (id: number, title: string, content: string, notebookId: number | null) =>
  invoke("upsert_note", { id, title, content, notebookId });

export const deleteNote = (id: number) => invoke("delete_note", { id });

export const moveNote = (noteId: number, notebookId: number | null) =>
  invoke("move_note", { noteId, notebookId });

export const createNotebook = (name: string, parentId: number | null) =>
  invoke<number>("create_notebook", { name, parentId });

export const deleteNotebook = (id: number) => invoke("delete_notebook", { id });

export const moveNotebook = (notebookId: number, parentId: number | null, index: number) =>
  invoke("move_notebook", { notebookId, parentId, index });
