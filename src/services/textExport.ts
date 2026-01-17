import { getNotebooks, getNotes, getNote } from "./notes";
import type { NoteDetail } from "../state/types";
import { getTags } from "./tags";
import {
  buildExportNoteMarkdown,
  buildFolderPath,
  buildNotebookMapForNotes,
  buildNoteFilename,
  prepareExportRoot,
  writeTextFile,
  type ExportSummary,
} from "./exportCommon";

type ExportReport = ExportSummary & {
  export_root: string;
  report_path: string;
};

export const runTextExport = async (
  destDir: string,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportReport> => {
  const errors: string[] = [];
  const exportRoot = await prepareExportRoot(destDir, "text");
  const notebooks = await getNotebooks();
  const tags = await getTags();
  const notesList = await getNotes(null);
  const notebookMap = buildNotebookMapForNotes(notebooks);
  const noteDetails: NoteDetail[] = [];
  const linkMap = new Map<number, { title: string; linkId: string }>();
  for (const item of notesList) {
    const note = await getNote(item.id);
    if (!note) continue;
    const title = note.title || "Untitled";
    const linkId = note.externalId?.trim() || String(note.id);
    linkMap.set(note.id, { title, linkId });
    noteDetails.push(note);
  }

  const usedNames = new Map<string, Map<string, number>>();
  const getUsed = (folder: string) => {
    if (!usedNames.has(folder)) {
      usedNames.set(folder, new Map<string, number>());
    }
    return usedNames.get(folder)!;
  };

  let attachments = 0;
  let images = 0;

  let processed = 0;
  onProgress?.(0, noteDetails.length);
  for (const note of noteDetails) {
    const [stack, notebook] = buildFolderPath(note, notebookMap);
    const folder = `${stack}/${notebook}`;
    const filename = buildNoteFilename(note, getUsed(folder), ".txt");
    try {
      const rendered = await buildExportNoteMarkdown(note, exportRoot, linkMap);
      attachments += rendered.attachments.length;
      images += rendered.images.length;
      errors.push(...rendered.errors);
      await writeTextFile(exportRoot, `${folder}/${filename}`, rendered.content);
      const meta = {
        id: note.id,
        title: note.title || "Untitled",
        link_id: linkMap.get(note.id)?.linkId || String(note.id),
        external_id: note.externalId ?? null,
        updated_at: note.updatedAt,
      };
      await writeTextFile(exportRoot, `${folder}/${filename}.meta.json`, JSON.stringify(meta, null, 2));
    } catch (e) {
      errors.push(`note ${note.id}: ${String(e)}`);
    }
    processed += 1;
    onProgress?.(processed, noteDetails.length);
  }

  const report: ExportReport = {
    export_root: exportRoot,
    notes: noteDetails.length,
    notebooks: notebooks.length,
    tags: tags.length,
    attachments,
    images,
    errors,
    report_path: "",
  };

  const reportPath = `${exportRoot}/export_report.json`;
  await writeTextFile(exportRoot, "export_report.json", JSON.stringify(report, null, 2));
  report.report_path = reportPath;
  return report;
};
