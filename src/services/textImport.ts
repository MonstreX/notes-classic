import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";
import { createNotebook, createNote, updateNote } from "./notes";
import { t } from "./i18n";

type FileEntry = {
  path: string;
  relPath: string;
};

type TextScanSummary = {
  sourceRoot: string;
  noteCount: number;
  stackCount: number;
  notebookCount: number;
  attachmentCount: number;
  imageCount: number;
  valid: boolean;
  errors: string[];
};

type TextImportReport = {
  startedAt: string;
  finishedAt: string;
  sourceRoot: string;
  targetDataDir: string;
  backupDir: string;
  failed: boolean;
  summary: TextScanSummary;
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
const createBackup = () => invoke<string>("create_import_backup", { kind: "text" });
const clearStorageForImport = () => invoke<void>("clear_storage_for_import");
const saveBytesAs = (destPath: string, bytes: number[]) =>
  invoke<void>("save_bytes_as", { destPath, bytes });

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

const splitWikiTarget = (raw: string) => {
  const cleaned = raw.trim().replace(/^\s*:/, "");
  const [target, alias] = cleaned.split("|");
  const withoutAnchor = target.split("#")[0].trim();
  const lower = withoutAnchor.toLowerCase();
  const isAsset = lower.startsWith("attachments/") || lower.startsWith("images/");
  const withoutExt = isAsset
    ? withoutAnchor
    : withoutAnchor.replace(/\.txt$/i, "").replace(/\.md$/i, "");
  return {
    target: withoutExt,
    label: (alias || withoutExt).trim(),
  };
};

const resolveStackNotebook = (relPath: string) => {
  const parts = relPath.split("/").filter(Boolean);
  const filename = parts.pop() || "";
  const folders = parts;
  if (folders.length === 0) {
    return { stack: "Text", notebook: "General", title: stripExt(filename) };
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
  const cleaned = relPath.replace(/\.txt$/i, "");
  return `text:${normalizeKey(cleaned)}`;
};

const resolveAttachmentPath = (
  noteDir: string,
  target: string,
  fileIndex: Map<string, string>
) => {
  const trimmed = target.replace(/^\.?[\\/]+/u, "");
  const hasExt = /\.[^/.]+$/u.test(trimmed);
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, localPath: null };
  }
  const isAbs = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/");
  if (isAbs) {
    return { url: null, localPath: trimmed };
  }
  const normalized = normalizeKey(trimmed);
  const noteRelative = noteDir ? normalizeKey(`${noteDir}/${trimmed}`) : "";
  const direct = fileIndex.get(normalized);
  if (direct) {
    return { url: null, localPath: direct };
  }
  if (noteRelative) {
    const scoped = fileIndex.get(noteRelative);
    if (scoped) {
      return { url: null, localPath: scoped };
    }
  }
  if (normalized.startsWith("attachments/") || normalized.startsWith("images/")) {
    const suffix = `/${normalized}`;
    for (const [key, value] of fileIndex.entries()) {
      if (key.endsWith(suffix) || key.endsWith(normalized)) {
        return { url: null, localPath: value };
      }
    }
    if (!hasExt) {
      for (const [key, value] of fileIndex.entries()) {
        if (key.startsWith(normalized + ".")) {
          return { url: null, localPath: value };
        }
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

const renderInline = async (
  raw: string,
  noteDir: string,
  linkMap: Map<string, string>,
  attachments: Array<{ token: string; name: string; path: string }>,
  fileIndex: Map<string, string>,
) => {
  const regex = /!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)|(attachments\/[^\s)\]]+)|(\S+\.(?:png|jpe?g|gif|webp|bmp|svg|jfif))/gi;
  let cursor = 0;
  let output = "";
  let imageCount = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    output += escapeHtml(raw.slice(cursor, match.index));
    const embed = match[1];
    const wiki = match[2];
    const mdImage = match[3];
    const bareAttachment = match[4];
    const bareImage = match[5];
    if (embed) {
      const parsed = splitWikiTarget(embed);
      const target = parsed.target;
      const resolved = resolveAttachmentPath(noteDir, target, fileIndex);
      if (resolved.url) {
        try {
          const stored = await downloadNoteFile(resolved.url);
          output += `<img data-en-hash="${stored.hash}" src="files/${stored.rel_path}">`;
          imageCount += 1;
        } catch {
          output += escapeHtml(embed);
        }
      } else if (resolved.localPath) {
        const filename = target.split("/").pop() || "file";
        if (isImagePath(target)) {
          try {
            const stored = await storeNoteFileFromPath(resolved.localPath);
            output += `<img data-en-hash="${stored.hash}" src="files/${stored.rel_path}">`;
            imageCount += 1;
          } catch {
            output += escapeHtml(embed);
          }
        } else {
          const token = `__ATTACHMENT_${attachments.length}__`;
          attachments.push({ token, name: filename, path: resolved.localPath });
          output += token;
        }
      }
    } else if (wiki) {
      const parsed = splitWikiTarget(wiki);
      const targetLower = parsed.target.toLowerCase();
      const extMatch = targetLower.includes(".") ? targetLower.split(".").pop() || "" : "";
      const looksLikeFile =
        targetLower.startsWith("attachments/") ||
        targetLower.startsWith("images/") ||
        (extMatch && extMatch !== "txt" && extMatch !== "md");
      if (looksLikeFile) {
        const resolved = resolveAttachmentPath(noteDir, parsed.target, fileIndex);
        if (resolved.localPath) {
          if (isImagePath(parsed.target)) {
            try {
              const stored = await storeNoteFileFromPath(resolved.localPath);
              output += `<img data-en-hash="${stored.hash}" src="files/${stored.rel_path}">`;
              imageCount += 1;
            } catch {
              output += escapeHtml(parsed.label || parsed.target);
            }
          } else {
            const filename = parsed.target.split("/").pop() || "file";
            const token = `__ATTACHMENT_${attachments.length}__`;
            attachments.push({ token, name: filename, path: resolved.localPath });
            output += token;
          }
        } else {
          output += escapeHtml(parsed.label || parsed.target);
        }
      } else {
        const key = normalizeKey(parsed.target);
        const fallbackKey = normalizeKey(parsed.target.split("/").pop() || parsed.target);
        const external = linkMap.get(key) || linkMap.get(fallbackKey);
        if (external) {
          const label = escapeHtml(parsed.label || parsed.target);
          output += `<a href="note://${escapeAttr(external)}" data-note-link="1">${label}</a>`;
        } else {
          output += escapeHtml(parsed.label || parsed.target);
        }
      }
    } else if (mdImage) {
      const cleaned = mdImage.trim();
      const resolved = resolveAttachmentPath(noteDir, cleaned, fileIndex);
      if (resolved.localPath) {
        if (isImagePath(cleaned)) {
          try {
            const stored = await storeNoteFileFromPath(resolved.localPath);
            output += `<img data-en-hash="${stored.hash}" src="files/${stored.rel_path}">`;
            imageCount += 1;
          } catch {
            output += escapeHtml(cleaned);
          }
        } else {
          const filename = cleaned.split("/").pop() || "file";
          const token = `__ATTACHMENT_${attachments.length}__`;
          attachments.push({ token, name: filename, path: resolved.localPath });
          output += token;
        }
      } else {
        output += escapeHtml(cleaned);
      }
    } else if (bareAttachment || bareImage) {
      const rawPath = (bareAttachment || bareImage || "").trim();
      const cleaned = rawPath.replace(/[),.;]+$/u, "");
      const tail = rawPath.slice(cleaned.length);
      const resolved = resolveAttachmentPath(noteDir, cleaned, fileIndex);
      if (resolved.localPath) {
        if (isImagePath(cleaned)) {
          try {
            const stored = await storeNoteFileFromPath(resolved.localPath);
            output += `<img data-en-hash="${stored.hash}" src="files/${stored.rel_path}">`;
            imageCount += 1;
          } catch {
            output += escapeHtml(rawPath);
          }
        } else {
          const filename = cleaned.split("/").pop() || "file";
          const token = `__ATTACHMENT_${attachments.length}__`;
          attachments.push({ token, name: filename, path: resolved.localPath });
          output += token;
        }
      } else {
        output += escapeHtml(rawPath);
      }
      output += escapeHtml(tail);
    }
    cursor = regex.lastIndex;
  }
  output += escapeHtml(raw.slice(cursor));

  output = output.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safeText = escapeHtml(text);
    const safeUrl = escapeAttr(url);
    return `<a href="${safeUrl}">${safeText}</a>`;
  });

  return { html: output.replace(/\n/g, "<br>"), imageCount };
};

const renderMarkdown = async (
  raw: string,
  noteDir: string,
  linkMap: Map<string, string>,
  fileIndex: Map<string, string>,
) => {
  const attachments: Array<{ token: string; name: string; path: string }> = [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const rendered: string[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  let inPre = false;
  let preBuffer: string[] = [];

  const flushParagraph = async () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n").trimEnd();
    if (!text) {
      buffer = [];
      return;
    }
    const result = await renderInline(text, noteDir, linkMap, attachments, fileIndex);
    rendered.push(`<p>${result.html}</p>`);
    imageCount += result.imageCount;
    buffer = [];
  };

  const flushList = async (
    items: Array<{ text: string; checked?: boolean }>,
    ordered: boolean,
    todo: boolean
  ) => {
    if (items.length === 0) return;
    const tag = ordered ? "ol" : "ul";
    const renderedItems: string[] = [];
    for (const item of items) {
      const result = await renderInline(item.text, noteDir, linkMap, attachments, fileIndex);
      imageCount += result.imageCount;
      if (todo) {
        renderedItems.push(
          `<li data-en-checked="${item.checked ? "true" : "false"}"><p>${result.html}</p></li>`
        );
      } else {
        renderedItems.push(`<li>${result.html}</li>`);
      }
    }
    const extra = todo ? ' data-en-todo="true"' : "";
    rendered.push(`<${tag}${extra}>${renderedItems.join("")}</${tag}>`);
  };

  let listItems: Array<{ text: string; checked?: boolean }> = [];
  let listOrdered = false;
  let listTodo = false;
  let imageCount = 0;
  const flushListBuffer = async () => {
    if (listItems.length === 0) return;
    await flushList(listItems, listOrdered, listTodo);
    listItems = [];
    listOrdered = false;
    listTodo = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\uFEFF/g, "");
    const trimmed = line.trimEnd();
    const trimmedStart = line.trimStart();

    if (/^```/.test(trimmedStart)) {
      await flushParagraph();
      await flushListBuffer();
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
      } else {
        const code = codeBuffer.join("\n");
        const safe = escapeHtml(code);
        rendered.push(
          `<div class="note-code" data-lang="auto">` +
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
            `<pre><code>${safe}</code></pre>` +
          `</div>`
        );
        inCode = false;
        codeBuffer = [];
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (trimmed.startsWith("<pre")) {
      await flushParagraph();
      await flushListBuffer();
      inPre = true;
      preBuffer.push(trimmed.replace(/^<pre[^>]*>/i, ""));
      continue;
    }
    if (inPre) {
      if (trimmed.toLowerCase().includes("</pre>")) {
        preBuffer.push(trimmed.replace(/<\/pre>.*/i, ""));
        const preText = preBuffer.join("\n");
        const safe = escapeHtml(preText).replace(/\n/g, "<br>");
        rendered.push(`<div class="note-callout"><p>${safe}</p></div>`);
        preBuffer = [];
        inPre = false;
      } else {
        preBuffer.push(line);
      }
      continue;
    }

    if (!trimmed) {
      await flushParagraph();
      await flushListBuffer();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      await flushParagraph();
      await flushListBuffer();
      rendered.push("<hr>");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      await flushParagraph();
      await flushListBuffer();
      const level = headingMatch[1].length;
      const content = await renderInline(headingMatch[2], noteDir, linkMap, attachments, fileIndex);
      if (level === 1) {
        // drop H1 to avoid title duplication
      } else {
        rendered.push(`<h${level}>${content.html}</h${level}>`);
        imageCount += content.imageCount;
      }
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    const todoMatch = trimmed.match(/^[-*+]\s+\[(x|X| )\]\s+(.*)$/);
    if (orderedMatch || unorderedMatch) {
      await flushParagraph();
      const isOrdered = !!orderedMatch;
      const isTodo = !!todoMatch && !isOrdered;
      if (listItems.length > 0 && listOrdered !== isOrdered) {
        await flushListBuffer();
      }
      if (listItems.length > 0 && listTodo !== isTodo) {
        await flushListBuffer();
      }
      listOrdered = isOrdered;
      listTodo = isTodo;
      if (todoMatch) {
        listItems.push({
          text: todoMatch[2].trim(),
          checked: todoMatch[1].toLowerCase() === "x",
        });
      } else {
        listItems.push({ text: (orderedMatch?.[2] ?? unorderedMatch?.[1] ?? "").trim() });
      }
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      await flushParagraph();
      await flushListBuffer();
      const content = await renderInline(quoteMatch[1], noteDir, linkMap, attachments, fileIndex);
      rendered.push(`<blockquote><p>${content.html}</p></blockquote>`);
      imageCount += content.imageCount;
      continue;
    }

    buffer.push(line);
  }

  await flushParagraph();
  await flushListBuffer();

  return { html: rendered.join(""), attachments, imageCount };
};

export const scanTextSource = async (root: string): Promise<TextScanSummary> => {
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
      errors: [t("import_text.scan_failed_generic")],
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
      errors: [t("import_text.scan_failed_generic")],
    };
  }

  const entries = await listFilesRecursive(root);
  const notes = entries.filter((entry) => entry.relPath.toLowerCase().endsWith(".txt"));
  const assets = entries.filter((entry) => !entry.relPath.toLowerCase().endsWith(".txt"));
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

export const runTextImport = async (
  root: string,
  onProgress?: (update: StageUpdate) => void,
) => {
  const report: TextImportReport = {
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

  const writeReport = async (payload: TextImportReport) => {
    if (!payload.backupDir) return "";
    const reportPath = `${payload.backupDir}/import_report.json`;
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload, null, 2)));
    await saveBytesAs(reportPath, bytes);
    return reportPath;
  };

  try {
    const summary = await scanTextSource(root);
    report.summary = summary;
    if (!summary.valid) {
      throw new Error(t("import_text.scan_failed_generic"));
    }
    const backupDir = await createBackup();
    report.backupDir = backupDir;
    report.targetDataDir = await getDataDir();
    await clearStorageForImport();
    const entries = await listFilesRecursive(root);
    const noteEntries = entries.filter((entry) => entry.relPath.toLowerCase().endsWith(".txt"));
    const fileIndex = new Map<string, string>();
    for (const entry of entries) {
      fileIndex.set(normalizeKey(entry.relPath), entry.path);
    }
    const linkMap = new Map<string, string>();
    const baseNameCounts = new Map<string, number>();
    for (const entry of noteEntries) {
      const relNoExt = entry.relPath.replace(/\.txt$/i, "");
      const baseName = relNoExt.split("/").pop() || relNoExt;
      const key = normalizeKey(baseName);
      baseNameCounts.set(key, (baseNameCounts.get(key) ?? 0) + 1);
    }
    for (const entry of noteEntries) {
      const relNoExt = entry.relPath.replace(/\.txt$/i, "");
      const externalId = buildExternalId(relNoExt);
      linkMap.set(normalizeKey(relNoExt), externalId);
      const baseName = relNoExt.split("/").pop() || relNoExt;
      const baseKey = normalizeKey(baseName);
      if ((baseNameCounts.get(baseKey) ?? 0) === 1 && !linkMap.has(baseKey)) {
        linkMap.set(normalizeKey(baseName), externalId);
      }
    }
    const ambiguous = Array.from(baseNameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
    if (ambiguous.length) {
      report.errors.push(`Ambiguous note aliases: ${ambiguous.join(", ")}`);
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
      const notebookId = await ensureNotebook(meta.stack, meta.notebook);
      const noteDir = entry.relPath.split("/").slice(0, -1).join("/");
      const bytes = await readFileBytes(entry.path);
      const raw = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
      const rendered = await renderMarkdown(raw, noteDir, linkMap, fileIndex);
      attachmentTotal.value += rendered.attachments.length + rendered.imageCount;
      report.stats.images += rendered.imageCount;
      filesDone += rendered.imageCount;
      onProgress?.({
        stage: "attachments",
        current: filesDone,
        total: attachmentTotal.value,
        state: "running",
      });
      const noteId = await createNote(meta.title || t("notes.untitled"), rendered.html, notebookId);
      await setNoteExternalId(noteId, buildExternalId(entry.relPath));

      if (rendered.attachments.length > 0) {
        let updated = rendered.html;
        for (const attachment of rendered.attachments) {
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
        await updateNote(noteId, meta.title || t("notes.untitled"), updated, notebookId);
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
    logError("[import] text failed", e);
    await writeReport(report);
    return report;
  }
};
