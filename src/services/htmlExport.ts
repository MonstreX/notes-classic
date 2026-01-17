import { getNotebooks, getNotes, getNote } from "./notes";
import { getTags } from "./tags";
import {
  buildExportNoteHtml,
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

const wrapHtml = (title: string, body: string) => {
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${safeTitle}</title>
  </head>
  <body>
${body}
  </body>
</html>
`;
};

export const runHtmlExport = async (
  destDir: string,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportReport> => {
  const errors: string[] = [];
  const exportRoot = await prepareExportRoot(destDir, "html");
  const notebooks = await getNotebooks();
  const tags = await getTags();
  const notesList = await getNotes(null);
  const notebookMap = buildNotebookMapForNotes(notebooks);
  const idToTitle = new Map<number, string>();
  notesList.forEach((note) => idToTitle.set(note.id, note.title || "Untitled"));

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
  onProgress?.(0, notesList.length);
  for (const item of notesList) {
    const note = await getNote(item.id);
    if (!note) continue;
    const [stack, notebook] = buildFolderPath(note, notebookMap);
    const folder = `${stack}/${notebook}`;
    const filename = buildNoteFilename(note, getUsed(folder), ".html");
    try {
      const rendered = await buildExportNoteHtml(note, exportRoot, idToTitle);
      attachments += rendered.attachments.length;
      images += rendered.images.length;
      const html = wrapHtml(note.title || "Untitled", rendered.content);
      await writeTextFile(exportRoot, `${folder}/${filename}`, html);
    } catch (e) {
      errors.push(`note ${note.id}: ${String(e)}`);
    }
    processed += 1;
    onProgress?.(processed, notesList.length);
  }

  const report: ExportReport = {
    export_root: exportRoot,
    notes: notesList.length,
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
