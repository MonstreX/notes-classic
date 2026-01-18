import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { logError } from "./logger";
import { sanitizeFilename } from "./exportUtils";

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
