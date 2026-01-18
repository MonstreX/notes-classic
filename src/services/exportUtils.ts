import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";

export type NotebookMap = {
  stacks: Map<number, string>;
  notebooks: Map<number, { name: string; parentId: number | null }>;
};

export const getDataDir = () => invoke<string>("get_data_dir");
export const readFileBytes = (path: string) => invoke<number[]>("read_file_bytes", { path });
export const saveBytesAs = (destPath: string, bytes: Uint8Array) =>
  invoke<void>("save_bytes_as", { destPath, bytes: Array.from(bytes) });
export const ensureDir = (path: string) => invoke<void>("ensure_dir", { path });

export const toUtf8Bytes = (text: string) => new TextEncoder().encode(text);

export const formatTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
};

export const sanitizeFilename = (value: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Untitled";
};

export const ensureUniqueName = (
  name: string,
  used: Map<string, number>,
  suffix: string
) => {
  const base = name;
  if (!used.has(base)) {
    used.set(base, 1);
    return base + suffix;
  }
  const count = (used.get(base) ?? 1) + 1;
  used.set(base, count);
  return `${base}-${count}${suffix}`;
};

export type ExportResult = {
  total: number;
  success: number;
  failed: number;
  path?: string;
  folder?: string;
  errors: string[];
};

export const normalizePathPart = (value: string) =>
  sanitizeFilename(value).replace(/\.+$/g, "");

export const buildNoteFolder = (
  notebookId: number | null,
  map: NotebookMap
) => {
  if (notebookId == null) {
    return { stack: "Unsorted", notebook: "General" };
  }
  const notebook = map.notebooks.get(notebookId);
  if (!notebook) {
    return { stack: "Unsorted", notebook: "General" };
  }
  const stackName =
    (notebook.parentId ? map.stacks.get(notebook.parentId) : null) || "General";
  return { stack: stackName, notebook: notebook.name };
};

export const decodeDataUrl = (url: string) => {
  const match = url.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { mime, bytes };
};

export const extractRelFromSrc = (src: string) => {
  if (!src) return null;
  if (src.startsWith("files/")) {
    return src.replace(/^files\/(evernote\/)?/i, "");
  }
  if (src.startsWith("files\\")) {
    return src.replace(/^files\\(evernote\\)?/i, "").replace(/\\/g, "/");
  }
  const assetMarker = "/files/";
  const decoded = decodeURIComponent(src);
  const idx = decoded.toLowerCase().indexOf(assetMarker);
  if (idx >= 0) {
    return decoded.slice(idx + assetMarker.length);
  }
  const encoded = src.toLowerCase();
  const encMarker = "%2ffiles%2f";
  const encIdx = encoded.indexOf(encMarker);
  if (encIdx >= 0) {
    const rel = src.slice(encIdx + encMarker.length);
    return decodeURIComponent(rel);
  }
  return null;
};

export const ensureDirForFile = async (root: string, relPath: string) => {
  const full = await join(root, relPath);
  return full;
};
