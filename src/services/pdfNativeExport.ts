import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { logError } from "./logger";
import { ensureUniqueName, sanitizeFilename, type ExportResult } from "./exportUtils";

export const exportNotePdfNative = async (
  noteId: number,
  title: string
): Promise<ExportResult | null> => {
  const suggestedName = sanitizeFilename(title?.trim() || "Note");
  try {
    const destPath = await save({
      defaultPath: `${suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destPath) return null;
    await invoke("export_note_pdf_native", { noteId, destPath });
    return {
      total: 1,
      success: 1,
      failed: 0,
      path: destPath,
      errors: [],
    };
  } catch (error) {
    logError("[export] pdf-native failed", error);
    return {
      total: 1,
      success: 0,
      failed: 1,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
};

export const exportNotesPdfNative = async (
  noteIds: number[],
  titleById: Map<number, string>
): Promise<ExportResult | null> => {
  if (!noteIds.length) return;
  try {
    const folder = await open({
      directory: true,
      multiple: false,
    });
    if (!folder || typeof folder !== "string") return null;
    const used = new Map<string, number>();
    const errors: string[] = [];
    let success = 0;
    for (const id of noteIds) {
      const title = titleById.get(id) || `Note-${id}`;
      const base = sanitizeFilename(title.trim() || `Note-${id}`);
      const filename = ensureUniqueName(base, used, ".pdf");
      const destPath = await join(folder, filename);
      try {
        await invoke("export_note_pdf_native", { noteId: id, destPath });
        success += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return {
      total: noteIds.length,
      success,
      failed: noteIds.length - success,
      folder,
      errors,
    };
  } catch (error) {
    logError("[export] pdf-native bulk failed", error);
    return {
      total: noteIds.length,
      success: 0,
      failed: noteIds.length,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
};
