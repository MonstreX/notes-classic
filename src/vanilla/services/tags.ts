import { invoke } from "@tauri-apps/api/core";
import type { Tag } from "../types";

export const getTags = () => invoke<Tag[]>("get_tags");

export const getNoteTags = (noteId: number) =>
  invoke<Tag[]>("get_note_tags", { noteId });

export const createTag = (name: string, parentId: number | null) =>
  invoke<number>("create_tag", { name, parentId });

export const addNoteTag = (noteId: number, tagId: number) =>
  invoke("add_note_tag", { noteId, tagId });

export const removeNoteTag = (noteId: number, tagId: number) =>
  invoke("remove_note_tag", { noteId, tagId });

export const deleteTag = (tagId: number) =>
  invoke("delete_tag", { tagId });
