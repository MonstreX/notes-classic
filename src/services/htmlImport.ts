import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";
import { createNotebook, createNote, updateNote } from "./notes";
import { t } from "./i18n";

type FileEntry = {
  path: string;
  relPath: string;
};

type HtmlScanSummary = {
  sourceRoot: string;
  noteCount: number;
  stackCount: number;
  notebookCount: number;
  attachmentCount: number;
  imageCount: number;
  valid: boolean;
  errors: string[];
};

type HtmlImportReport = {
  startedAt: string;
  finishedAt: string;
  sourceRoot: string;
  targetDataDir: string;
  backupDir: string;
  failed: boolean;
  summary: HtmlScanSummary;
  stats: {
    notes: number;
    stacks: number;
    notebooks: number;
    attachments: number;
    images: number;
  };
  errors: string[];
};

type StoredNoteFile = {
  rel_path: string;
  hash: string;
  mime: string;
};

type AttachmentInfo = {
  id: number;
  note_id: number;
  filename: string;
  mime: string;
  size: number;
};

type StageUpdate = {
  stage: "notes" | "attachments" | "database";
  current: number;
  total: number;
  state?: "running" | "done" | "error";
  message?: string;
};

const listFilesRecursive = (root: string) =>
  invoke<FileEntry[]>("list_files_recursive", { root });
const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
const pathIsDir = (path: string) => invoke<boolean>("path_is_dir", { path });
const readFileBytes = (path: string) => invoke<number[]>("read_file_bytes", { path });
const storeNoteFileFromPath = (sourcePath: string) =>
  invoke<StoredNoteFile>("store_note_file_from_path", { sourcePath });
const downloadNoteFile = (url: string) =>
  invoke<StoredNoteFile>("download_note_file", { url });
const importAttachmentBytes = (noteId: number, filename: string, mime: string, bytes: number[]) =>
  invoke<AttachmentInfo>("import_attachment_bytes", { noteId, filename, mime, bytes });
const setNoteExternalId = (noteId: number, externalId: string) =>
  invoke<void>("set_note_external_id", { noteId, externalId });
const getDataDir = () => invoke<string>("get_data_dir");
const createBackup = () => invoke<string>("create_import_backup", { kind: "html" });
const clearStorageForImport = () => invoke<void>("clear_storage_for_import");
const saveBytesAs = (destPath: string, bytes: number[]) =>
  invoke<void>("save_bytes_as", { destPath, bytes });

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const downloadNoteFileWithTimeout = (url: string, ms = 10000) =>
  withTimeout(downloadNoteFile(url), ms);

const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".jfif", ".tif", ".tiff"];

const isImagePath = (path: string) =>
  imageExts.some((ext) => path.toLowerCase().endsWith(ext));

const stripExt = (filename: string) => filename.replace(/\.[^/.]+$/u, "");

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeAttr = (value: string) =>
  escapeHtml(value).replace(/"/g, "&quot;");

const normalizeKey = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();

const fallbackHtmlFromText = (raw: string) => {
  const safe = escapeHtml(raw).replace(/\n/g, "<br>");
  return `<p>${safe}</p>`;
};

const isLikelyEncoded = (raw: string) => {
  const sample = raw.slice(0, 120000);
  let totalChars = 0;
  let base64Chars = 0;
  let longestBase64Run = 0;
  let currentRun = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const ch = sample[i];
    if (ch.trim()) {
      totalChars += 1;
    }
    if (/[A-Za-z0-9+/=]/.test(ch)) {
      base64Chars += 1;
      currentRun += 1;
      if (currentRun > longestBase64Run) longestBase64Run = currentRun;
    } else if (ch === "\n" || ch === "\r" || ch === " " || ch === "\t") {
      currentRun = 0;
    } else {
      currentRun = 0;
    }
  }
  if (totalChars < 20000) return false;
  const ratio = base64Chars / totalChars;
  return longestBase64Run >= 5000 && ratio >= 0.97;
};

const guessMime = (filename: string) => {
  const lower = filename.trim().toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    jfif: "image/jpeg",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
  };
  return map[ext] || "";
};

const resolveStackNotebook = (relPath: string) => {
  const parts = relPath.split("/").filter(Boolean);
  const filename = parts.pop() || "";
  const folders = parts;
  if (folders.length === 0) {
    return { stack: "HTML", notebook: "General", title: stripExt(filename) };
  }
  if (folders.length === 1) {
    return { stack: folders[0], notebook: "General", title: stripExt(filename) };
  }
  return {
    stack: folders[0],
    notebook: folders.slice(1).join("."),
    title: stripExt(filename),
  };
};

const buildExternalId = (relPath: string) => {
  const cleaned = relPath.replace(/\.html$/i, "");
  return `html:${normalizeKey(cleaned)}`;
};

const normalizeRelPath = (value: string) => {
  const cleaned = value.replace(/\\/g, "/");
  const parts: string[] = [];
  cleaned.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.join("/");
};

const resolveAssetPath = (
  noteDir: string,
  target: string,
  fileIndex: Map<string, string>
) => {
  const trimmed = target.replace(/^\.?[\\/]+/u, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, localPath: null };
  }
  const isAbs = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/");
  if (isAbs) {
    return { url: null, localPath: trimmed };
  }
  const directNormalized = normalizeKey(normalizeRelPath(trimmed));
  const direct = fileIndex.get(directNormalized);
  if (direct) {
    return { url: null, localPath: direct };
  }
  const resolved = normalizeRelPath(noteDir ? `${noteDir}/${trimmed}` : trimmed);
  const normalized = normalizeKey(resolved);
  const scoped = fileIndex.get(normalized);
  if (scoped) {
    return { url: null, localPath: scoped };
  }
  if (normalized.startsWith("attachments/") || normalized.startsWith("images/")) {
    const suffix = `/${normalized}`;
    for (const [key, value] of fileIndex.entries()) {
      if (key.endsWith(suffix) || key.endsWith(normalized)) {
        return { url: null, localPath: value };
      }
    }
  }
  if (directNormalized.startsWith("attachments/") || directNormalized.startsWith("images/")) {
    const suffix = `/${directNormalized}`;
    for (const [key, value] of fileIndex.entries()) {
      if (key.endsWith(suffix) || key.endsWith(directNormalized)) {
        return { url: null, localPath: value };
      }
    }
  }
  return { url: null, localPath: null };
};

const buildAttachmentHtml = (attachment: AttachmentInfo) => {
  const size = attachment.size;
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const sizeLabel = `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  return `
    <div class="note-attachment" data-attachment-id="${attachment.id}" data-attachment-name="${attachment.filename}" data-attachment-size="${attachment.size}" data-attachment-mime="${attachment.mime}" contenteditable="false">
      <div class="note-attachment__main">
        <svg class="note-attachment__icon" aria-hidden="true"><use href="#icon-attach"></use></svg>
        <div class="note-attachment__meta">
          <span class="note-attachment__name">${escapeHtml(attachment.filename)}</span>
          <span class="note-attachment__size">${sizeLabel}</span>
        </div>
      </div>
      <div class="note-attachment__actions" contenteditable="false">
        <button class="note-attachment__action" data-attachment-action="download" type="button">${t("attachments.download")}</button>
        <button class="note-attachment__action" data-attachment-action="open" type="button">${t("attachments.view")}</button>
        <button class="note-attachment__action note-attachment__action--danger" data-attachment-action="delete" type="button">${t("attachments.delete")}</button>
      </div>
    </div>
  `.trim();
};

const renderHtml = async (
  raw: string,
  noteDir: string,
  fileIndex: Map<string, string>,
  attachments: Array<{ token: string; name: string; path: string }>,
) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");
  const body = doc.body;

  body.querySelectorAll("script,style").forEach((node) => node.remove());

  body.querySelectorAll("h1").forEach((node) => node.remove());

  body.querySelectorAll("ul,ol").forEach((list) => {
    const items = Array.from(list.querySelectorAll("li"));
    const hasCheckbox = items.some((item) => item.querySelector("input[type=\"checkbox\"]"));
    if (!hasCheckbox) return;
    list.setAttribute("data-en-todo", "true");
    items.forEach((item) => {
      const checkbox = item.querySelector("input[type=\"checkbox\"]");
      if (!checkbox) return;
      const checked = checkbox.hasAttribute("checked");
      checkbox.remove();
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => el.remove());
      const content = clone.innerHTML.trim() || escapeHtml(item.textContent || "");
      item.innerHTML = `<p>${content}</p>`;
      item.setAttribute("data-en-checked", checked ? "true" : "false");
    });
  });

  body.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const safe = escapeHtml(code.textContent || "");
    const wrapper = doc.createElement("div");
    wrapper.className = "note-code";
    wrapper.setAttribute("data-lang", "auto");
    wrapper.innerHTML =
      `<div class="note-code-toolbar" contenteditable="false">` +
      `<select class="note-code-select">` +
      `<option value="auto" selected>AUTO</option>` +
      `<option value="php">PHP</option>` +
      `<option value="html">HTML</option>` +
      `<option value="js">JS</option>` +
      `<option value="css">CSS</option>` +
      `</select>` +
      `<button class="note-code-copy" type="button">${escapeHtml(t("attachments.copy"))}</button>` +
      `</div>` +
      `<pre><code>${safe}</code></pre>`;
    pre.replaceWith(wrapper);
  });

  let imageCount = 0;
  const imageNodes = Array.from(body.querySelectorAll("img"));
  for (const img of imageNodes) {
    const src = img.getAttribute("src") || "";
    if (!src) continue;
    const resolved = resolveAssetPath(noteDir, src, fileIndex);
    if (resolved.url) {
      try {
        const stored = await downloadNoteFileWithTimeout(resolved.url);
        img.setAttribute("src", `files/${stored.rel_path}`);
        img.setAttribute("data-en-hash", stored.hash);
        imageCount += 1;
      } catch {
        img.setAttribute("data-en-external", "1");
      }
    } else if (resolved.localPath) {
      if (!isImagePath(resolved.localPath)) continue;
      try {
        const stored = await storeNoteFileFromPath(resolved.localPath);
        img.setAttribute("src", `files/${stored.rel_path}`);
        img.setAttribute("data-en-hash", stored.hash);
        imageCount += 1;
      } catch {
        // keep original
      }
    }
  }

  const linkNodes = Array.from(body.querySelectorAll("a[href]"));
  for (const link of linkNodes) {
    const href = link.getAttribute("href") || "";
    if (!href) continue;
    const resolved = resolveAssetPath(noteDir, href, fileIndex);
    if (resolved.url) {
      link.setAttribute("data-en-external", "1");
      continue;
    }
    if (!resolved.localPath) continue;
    if (isImagePath(resolved.localPath)) continue;
    const filename = href.split("/").pop() || "file";
    const token = `__ATTACHMENT_${attachments.length}__`;
    attachments.push({ token, name: filename, path: resolved.localPath });
    const placeholder = doc.createTextNode(token);
    link.replaceWith(placeholder);
  }

  return { html: body.innerHTML, imageCount };
};

export const scanHtmlSource = async (root: string): Promise<HtmlScanSummary> => {
  const errors: string[] = [];
  if (!root) {
    return {
      sourceRoot: "",
      noteCount: 0,
      stackCount: 0,
      notebookCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [t("import_html.scan_failed_generic")],
    };
  }
  const exists = await pathExists(root);
  const isDir = exists ? await pathIsDir(root) : false;
  if (!exists || !isDir) {
    return {
      sourceRoot: root,
      noteCount: 0,
      stackCount: 0,
      notebookCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [t("import_html.scan_failed_generic")],
    };
  }

  const entries = await listFilesRecursive(root);
  const notes = entries.filter((entry) => entry.relPath.toLowerCase().endsWith(".html"));
  const assets = entries.filter((entry) => !entry.relPath.toLowerCase().endsWith(".html"));
  const stacks = new Map<string, Set<string>>();
  for (const note of notes) {
    const meta = resolveStackNotebook(note.relPath);
    if (!stacks.has(meta.stack)) stacks.set(meta.stack, new Set());
    stacks.get(meta.stack)?.add(meta.notebook);
  }
  const stackCount = stacks.size;
  const notebookCount = Array.from(stacks.values()).reduce((sum, set) => sum + set.size, 0);
  const imageCount = assets.filter((entry) => isImagePath(entry.relPath)).length;

  return {
    sourceRoot: root,
    noteCount: notes.length,
    stackCount,
    notebookCount,
    attachmentCount: assets.length,
    imageCount,
    valid: notes.length > 0,
    errors,
  };
};

export const runHtmlImport = async (
  root: string,
  onProgress?: (update: StageUpdate) => void,
) => {
  const report: HtmlImportReport = {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    sourceRoot: root,
    targetDataDir: "",
    backupDir: "",
    failed: false,
    summary: {
      sourceRoot: root,
      noteCount: 0,
      stackCount: 0,
      notebookCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [],
    },
    stats: {
      notes: 0,
      stacks: 0,
      notebooks: 0,
      attachments: 0,
      images: 0,
    },
    errors: [],
  };

  const writeReport = async (payload: HtmlImportReport) => {
    if (!payload.backupDir) return "";
    const reportPath = `${payload.backupDir}/import_report.json`;
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload, null, 2)));
    await saveBytesAs(reportPath, bytes);
    return reportPath;
  };

  try {
    const summary = await scanHtmlSource(root);
    report.summary = summary;
    if (!summary.valid) {
      throw new Error(t("import_html.scan_failed_generic"));
    }
    const backupDir = await createBackup();
    report.backupDir = backupDir;
    report.targetDataDir = await getDataDir();
    await clearStorageForImport();
    const entries = await listFilesRecursive(root);
    const noteEntries = entries.filter((entry) => entry.relPath.toLowerCase().endsWith(".html"));
    const fileIndex = new Map<string, string>();
    for (const entry of entries) {
      fileIndex.set(normalizeKey(entry.relPath), entry.path);
    }

    const stackIds = new Map<string, number>();
    const notebookIds = new Map<string, number>();
    const ensureNotebook = async (stack: string, notebook: string) => {
      if (!stackIds.has(stack)) {
        const stackId = await createNotebook(stack, null);
        stackIds.set(stack, stackId);
        report.stats.stacks += 1;
      }
      const key = `${stack}::${notebook}`;
      if (!notebookIds.has(key)) {
        const parentId = stackIds.get(stack) ?? null;
        const notebookId = await createNotebook(notebook, parentId);
        notebookIds.set(key, notebookId);
        report.stats.notebooks += 1;
      }
      return notebookIds.get(key) ?? null;
    };

    const attachmentTotal = { value: 0 };
    let filesDone = 0;
    onProgress?.({ stage: "notes", current: 0, total: noteEntries.length, state: "running" });
    onProgress?.({ stage: "attachments", current: 0, total: 0, state: "running" });

    let noteIndex = 0;
    for (const entry of noteEntries) {
      const meta = resolveStackNotebook(entry.relPath);
      const noteTitle = meta.title || t("notes.untitled");
      onProgress?.({
        stage: "notes",
        current: noteIndex,
        total: noteEntries.length,
        state: "running",
        message: noteTitle,
      });
      const notebookId = await ensureNotebook(meta.stack, meta.notebook);
      const noteDir = entry.relPath.split("/").slice(0, -1).join("/");
      const bytes = await readFileBytes(entry.path);
      const raw = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
      const attachments: Array<{ token: string; name: string; path: string }> = [];
      let rendered = { html: fallbackHtmlFromText(raw), imageCount: 0 };
      if (isLikelyEncoded(raw)) {
        report.errors.push(`note ${noteTitle}: content looks encoded, skipped html parsing`);
      } else {
        rendered = await renderHtml(raw, noteDir, fileIndex, attachments);
      }
      attachmentTotal.value += attachments.length + rendered.imageCount;
      report.stats.images += rendered.imageCount;
      filesDone += rendered.imageCount;
      onProgress?.({
        stage: "attachments",
        current: filesDone,
        total: attachmentTotal.value,
        state: "running",
      });
      const noteId = await createNote(noteTitle, rendered.html, notebookId);
      await setNoteExternalId(noteId, buildExternalId(entry.relPath));

      if (attachments.length > 0) {
        let updated = rendered.html;
        for (const attachment of attachments) {
          try {
            const bytesValue = await readFileBytes(attachment.path);
            const attachmentInfo = await importAttachmentBytes(
              noteId,
              attachment.name,
              guessMime(attachment.name || attachment.path),
              bytesValue,
            );
            updated = updated.replace(attachment.token, buildAttachmentHtml(attachmentInfo));
            report.stats.attachments += 1;
            filesDone += 1;
            onProgress?.({
              stage: "attachments",
              current: filesDone,
              total: attachmentTotal.value,
              state: "running",
            });
          } catch (e) {
            report.errors.push(String(e));
            updated = updated.replace(attachment.token, escapeHtml(attachment.name));
            filesDone += 1;
            onProgress?.({
              stage: "attachments",
              current: filesDone,
              total: attachmentTotal.value,
              state: "running",
            });
          }
        }
        await updateNote(noteId, noteTitle, updated, notebookId);
      }

      noteIndex += 1;
      report.stats.notes += 1;
      onProgress?.({ stage: "notes", current: noteIndex, total: noteEntries.length, state: "running" });
    }
    onProgress?.({ stage: "notes", current: noteEntries.length, total: noteEntries.length, state: "done" });
    onProgress?.({
      stage: "attachments",
      current: filesDone,
      total: attachmentTotal.value,
      state: "done",
    });
    onProgress?.({ stage: "database", current: 1, total: 1, state: "done" });
    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    return report;
  } catch (e) {
    report.finishedAt = new Date().toISOString();
    report.failed = true;
    report.errors.push(String(e));
    logError("[import] html failed", e);
    await writeReport(report);
    return report;
  }
};
