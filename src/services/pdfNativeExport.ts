import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { logError } from "./logger";
import { ensureUniqueName, sanitizeFilename } from "./exportUtils";

export const exportNotePdfNative = async (noteId: number, title: string) => {
  const suggestedName = sanitizeFilename(title?.trim() || "Note");
  try {
    const destPath = await save({
      defaultPath: `${suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destPath) return;
    await invoke("export_note_pdf_native", { noteId, destPath });
  } catch (error) {
    logError("[export] pdf-native failed", error);
  }
};

export const exportNotesPdfNative = async (
  noteIds: number[],
  titleById: Map<number, string>
) => {
  if (!noteIds.length) return;
  try {
    const folder = await open({
      directory: true,
      multiple: false,
    });
    if (!folder || typeof folder !== "string") return;
    const used = new Map<string, number>();
    for (const id of noteIds) {
      const title = titleById.get(id) || `Note-${id}`;
      const base = sanitizeFilename(title.trim() || `Note-${id}`);
      const filename = ensureUniqueName(base, used, ".pdf");
      const destPath = await join(folder, filename);
      await invoke("export_note_pdf_native", { noteId: id, destPath });
    }
  } catch (error) {
    logError("[export] pdf-native bulk failed", error);
  }
};
