import { invoke } from "@tauri-apps/api/core";

type StoredNoteFile = {
  rel_path: string;
  hash: string;
  mime: string;
};

export const storeNoteFileBytes = (filename: string, mime: string, bytes: Uint8Array) =>
  invoke<StoredNoteFile>("store_note_file_bytes", {
    filename,
    mime,
    bytes: Array.from(bytes),
  });

export const downloadNoteFile = (url: string) =>
  invoke<StoredNoteFile>("download_note_file", { url });
