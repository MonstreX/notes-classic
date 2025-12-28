export interface Notebook {
  id: number;
  name: string;
  parentId: number | null;
  notebookType: "stack" | "notebook";
  sortOrder: number;
  externalId?: string | null;
}

export interface NoteListItem {
  id: number;
  title: string;
  content: string;
  excerpt?: string;
  updatedAt: number;
  notebookId: number | null;
}

export interface NoteDetail {
  id: number;
  title: string;
  content: string;
  updatedAt: number;
  notebookId: number | null;
  externalId?: string | null;
  meta?: string | null;
  contentHash?: string | null;
  contentSize?: number | null;
}

export interface Tag {
  id: number;
  name: string;
  parentId: number | null;
}

export interface NoteCounts {
  total: number;
  perNotebook: { notebookId: number; count: number }[];
}

export type NotesListView = "detailed" | "compact";
export type NotesSortBy = "updated" | "title";
export type NotesSortDir = "asc" | "desc";
