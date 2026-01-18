import { open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { getNote } from "./notes";
import { readAttachmentBytes } from "./attachments";
import { logError } from "./logger";
import {
  extractRelFromSrc,
  getDataDir,
  readFileBytes,
  saveBytesAs,
  ensureUniqueName,
  sanitizeFilename,
  toUtf8Bytes,
  type ExportResult,
} from "./exportUtils";

const stripSelectionMarkers = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("[data-jodit-selection_marker], [data-jodit-temp]").forEach((el) => el.remove());
  doc.body.querySelectorAll("span").forEach((el) => {
    if (!el.textContent?.trim() && el.attributes.length === 0) {
      el.remove();
    }
  });
  return doc;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const buildDataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${bytesToBase64(bytes)}`;

const mimeFromExt = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".jfif")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const embedImages = async (doc: Document) => {
  const dataDir = await getDataDir();
  const images = Array.from(doc.querySelectorAll("img"));
  for (const img of images) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) continue;
    const rel = src.startsWith("notes-file://")
      ? src.replace("notes-file://", "").replace(/^files[\\/]/i, "")
      : extractRelFromSrc(src);
    if (!rel) continue;
    try {
      const fullPath = await join(dataDir, "files", rel);
      const raw = await readFileBytes(fullPath);
      const bytes = Uint8Array.from(raw);
      const mime = mimeFromExt(rel);
      img.setAttribute("src", buildDataUrl(mime, bytes));
    } catch {
      // keep original src
    }
  }
};

const embedAttachments = async (doc: Document) => {
  const nodes = Array.from(doc.querySelectorAll(".note-attachment")) as HTMLElement[];
  for (const node of nodes) {
    const name = node.getAttribute("data-attachment-name") || "attachment.bin";
    const size = Number(node.getAttribute("data-attachment-size") || "0");
    const mime = node.getAttribute("data-attachment-mime") || "application/octet-stream";
    const embedded = node.getAttribute("data-attachment-embedded") === "1";
    const embeddedData = node.getAttribute("data-attachment-data");
    let dataUrl: string | null = null;
    if (embedded && embeddedData) {
      dataUrl = `data:${mime};base64,${embeddedData}`;
    } else {
      const id = Number(node.getAttribute("data-attachment-id") || 0);
      if (id) {
        const bytes = await readAttachmentBytes(id);
        dataUrl = buildDataUrl(mime, bytes);
      }
    }
    if (!dataUrl) {
      node.replaceWith(doc.createTextNode(name));
      continue;
    }
    const wrap = doc.createElement("div");
    wrap.className = "note-attachment-export";
    const link = doc.createElement("a");
    link.href = dataUrl;
    link.textContent = name;
    link.setAttribute("download", name);
    const sizeEl = doc.createElement("span");
    sizeEl.className = "note-attachment-export__size";
    sizeEl.textContent = formatBytes(size);
    wrap.appendChild(link);
    if (sizeEl.textContent) wrap.appendChild(sizeEl);
    node.replaceWith(wrap);
  }
};

const buildHtml = (title: string, body: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px 28px; color: #111827; }
      h1 { font-size: 22px; font-weight: 500; margin: 0 0 16px; }
      p { margin: 0 0 0.9em; }
      h2, h3, h4, h5, h6 { margin: 1em 0 0.6em; font-weight: 600; }
      ul, ol { margin: 0 0 1em 1.5em; padding: 0; }
      li { margin: 0.25em 0; }
      hr { border: none; border-top: 1px solid #d3d3d3; margin: 1.2em 0; }
      a { color: #0b6ee0; text-decoration: underline; }
      img { max-width: 100%; height: auto; }
      table { border-collapse: collapse; margin: 0 0 1em; }
      th, td { border: 1px solid #e5e7eb; padding: 6px 8px; }
      pre { white-space: pre-wrap; word-break: break-word; }
      code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
      .note-callout { background: #f3f3f3; border-radius: 4px; padding: 10px 15px; margin: 0 0 1em; font-size: 13px; line-height: 1.2; }
      .note-code { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px; margin: 0 0 1em; font-family: Consolas, "Courier New", monospace; font-size: 12px; }
      .note-secure { display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 4px; border: 1px solid #e5e7eb; background: #f3f4f6; color: #6b7280; font-size: 12px; }
      .note-attachment-export { display: flex; align-items: center; gap: 8px; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; background: #f9fafb; font-size: 12px; margin: 0 0 1em; }
      .note-attachment-export__size { color: #6b7280; font-size: 11px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    ${body}
  </body>
</html>`;

const exportNoteHtmlOneFileToPath = async (
  noteId: number,
  destPath: string,
  fallbackTitle: string
) => {
  const note = await getNote(noteId);
  if (!note) return;
  const doc = stripSelectionMarkers(note.content || "");
  await embedImages(doc);
  await embedAttachments(doc);
  const html = buildHtml(note.title || fallbackTitle, doc.body.innerHTML);
  const finalPath = destPath.toLowerCase().endsWith(".html") ? destPath : `${destPath}.html`;
  await saveBytesAs(finalPath, toUtf8Bytes(html));
};

export const exportNoteHtmlOneFile = async (
  noteId: number,
  title: string
): Promise<ExportResult | null> => {
  const suggestedName = sanitizeFilename(title?.trim() || "Note");
  try {
    const destPath = await save({
      defaultPath: `${suggestedName}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!destPath) return null;
    await exportNoteHtmlOneFileToPath(noteId, destPath, suggestedName);
    return {
      total: 1,
      success: 1,
      failed: 0,
      path: destPath,
      errors: [],
    };
  } catch (error) {
    logError("[export] html-one-file failed", error);
    return {
      total: 1,
      success: 0,
      failed: 1,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
};

export const exportNotesHtmlOneFile = async (
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
      const filename = ensureUniqueName(base, used, ".html");
      const destPath = await join(folder, filename);
      try {
        await exportNoteHtmlOneFileToPath(id, destPath, base);
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
    logError("[export] html-one-file bulk failed", error);
    return {
      total: noteIds.length,
      success: 0,
      failed: noteIds.length,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
};
