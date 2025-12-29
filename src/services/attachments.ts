import { invoke } from "@tauri-apps/api/core";

export type AttachmentInfo = {
  id: number;
  noteId: number;
  filename: string;
  mime: string;
  size: number;
  localPath: string;
};

export const importAttachment = (noteId: number, sourcePath: string) =>
  invoke<AttachmentInfo>("import_attachment", { noteId, sourcePath });

export const importAttachmentBytes = (
  noteId: number,
  filename: string,
  mime: string,
  bytes: Uint8Array
) => invoke<AttachmentInfo>("import_attachment_bytes", {
  noteId,
  filename,
  mime,
  bytes,
});

export const deleteAttachment = (id: number) =>
  invoke("delete_attachment", { id });

export const saveAttachmentAs = (id: number, destPath: string) =>
  invoke("save_attachment_as", { id, destPath });

export const readAttachmentText = (id: number, maxBytes: number) =>
  invoke<string>("read_attachment_text", { id, maxBytes });
