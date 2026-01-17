import { join } from "@tauri-apps/api/path";
import { readAttachmentBytes } from "./attachments";
import {
  buildNoteFolder,
  decodeDataUrl,
  ensureDirForFile,
  ensureUniqueName,
  extractRelFromSrc,
  formatTimestamp,
  getDataDir,
  normalizePathPart,
  readFileBytes,
  sanitizeFilename,
  ensureDir,
  saveBytesAs,
  toUtf8Bytes,
  type NotebookMap,
} from "./exportUtils";
import type { NoteDetail, Notebook } from "../state/types";

type ExportAsset = {
  relPath: string;
  filename: string;
};

type ExportNoteResult = {
  content: string;
  attachments: ExportAsset[];
  images: ExportAsset[];
};

const getExtensionFromMime = (mime: string) => {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
  };
  return map[mime] || ".bin";
};

const buildNotebookMap = (notebooks: Notebook[]): NotebookMap => {
  const stacks = new Map<number, string>();
  const notebooksMap = new Map<number, { name: string; parentId: number | null }>();
  notebooks.forEach((nb) => {
    if (nb.notebookType === "stack") {
      stacks.set(nb.id, nb.name);
    } else {
      notebooksMap.set(nb.id, { name: nb.name, parentId: nb.parentId });
    }
  });
  return { stacks, notebooks: notebooksMap };
};

const formatStackNotebookPath = (note: NoteDetail, map: NotebookMap) => {
  const { stack, notebook } = buildNoteFolder(note.notebookId, map);
  return [normalizePathPart(stack), normalizePathPart(notebook)];
};

const escapeMarkdownText = (value: string) =>
  value.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n");

const nodeToMarkdown = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const serializeChildren = () =>
    Array.from(el.childNodes).map(nodeToMarkdown).join("");

  if (tag === "p") {
    const text = serializeChildren().trim();
    return text ? `${text}\n\n` : "";
  }
  if (tag === "br") {
    return "\n";
  }
  if (tag === "strong" || tag === "b") {
    return `**${serializeChildren().trim()}**`;
  }
  if (tag === "em" || tag === "i") {
    return `*${serializeChildren().trim()}*`;
  }
  if (tag === "code") {
    return `\`${serializeChildren()}\``;
  }
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    const text = serializeChildren().trim() || href;
    return href ? `[${text}](${href})` : text;
  }
  if (tag === "img") {
    const src = el.getAttribute("src") || "";
    return src ? `![](${src})` : "";
  }
  if (tag === "hr") {
    return "---\n\n";
  }
  if (tag === "blockquote") {
    const text = serializeChildren().trim();
    if (!text) return "";
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n") + "\n\n";
  }
  if (tag === "ul" || tag === "ol") {
    const isTodo = el.getAttribute("data-en-todo") === "true";
    const ordered = tag === "ol";
    const items = Array.from(el.querySelectorAll(":scope > li"));
    const lines = items.map((item, idx) => {
      const checked = item.getAttribute("data-en-checked") === "true";
      const itemText = Array.from(item.childNodes).map(nodeToMarkdown).join("").trim();
      if (isTodo) {
        return `- [${checked ? "x" : " "}] ${itemText}`;
      }
      if (ordered) {
        return `${idx + 1}. ${itemText}`;
      }
      return `- ${itemText}`;
    });
    return lines.join("\n") + "\n\n";
  }
  if (tag.startsWith("h")) {
    const level = Number(tag.slice(1));
    if (Number.isFinite(level) && level >= 2 && level <= 6) {
      const prefix = "#".repeat(level);
      return `${prefix} ${serializeChildren().trim()}\n\n`;
    }
    return "";
  }
  if (tag === "pre") {
    const text = el.textContent || "";
    return `<pre>\n${text}\n</pre>\n\n`;
  }
  if (tag === "div" && el.classList.contains("note-code")) {
    const lang = el.getAttribute("data-lang") || "auto";
    const codeEl = el.querySelector("pre > code");
    const code = codeEl?.textContent || "";
    return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  }
  if (tag === "div" && el.classList.contains("note-callout")) {
    const text = el.textContent || "";
    return `<pre>\n${text}\n</pre>\n\n`;
  }
  return serializeChildren();
};

const htmlToMarkdown = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("h1").forEach((node) => node.remove());
  const raw = Array.from(body.childNodes).map(nodeToMarkdown).join("");
  return raw.replace(/\n{3,}/g, "\n\n").trim() + "\n";
};

const replaceNoteLinks = (node: HTMLElement, idToTitle: Map<number, string>) => {
  node.querySelectorAll("a[href^=\"note://\"]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const id = href.replace("note://", "");
    const title = idToTitle.get(Number(id)) || link.textContent || href;
    link.textContent = title;
  });
};

const exportAttachments = async (
  note: NoteDetail,
  doc: Document,
  exportRoot: string,
  attachments: ExportAsset[],
  mode: "html" | "text",
) => {
  const nodes = Array.from(doc.querySelectorAll(".note-attachment")) as HTMLElement[];
  const usedNames = new Map<string, number>();
  for (const node of nodes) {
    const embedded = node.getAttribute("data-attachment-embedded") === "1";
    const data = node.getAttribute("data-attachment-data");
    const rawName = node.getAttribute("data-attachment-name") || "attachment.bin";
    const filename = sanitizeFilename(rawName);
    const extIdx = filename.lastIndexOf(".");
    const base = extIdx > 0 ? filename.slice(0, extIdx) : filename;
    const ext = extIdx > 0 ? filename.slice(extIdx) : "";
    const uniqueName = ensureUniqueName(base, usedNames, ext);
    const relPath = `attachments/${note.id}/${uniqueName}`;
    let bytes: Uint8Array | null = null;
    if (embedded && data) {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } else {
      const id = Number(node.getAttribute("data-attachment-id") || 0);
      if (id) {
        bytes = await readAttachmentBytes(id);
      }
    }
    if (bytes) {
      const dest = await ensureDirForFile(exportRoot, relPath);
      await saveBytesAs(dest, bytes);
      attachments.push({ relPath, filename: uniqueName });
      if (mode === "html") {
        const link = doc.createElement("a");
        link.setAttribute("href", relPath);
        link.textContent = uniqueName;
        node.replaceWith(link);
      } else {
        node.replaceWith(doc.createTextNode(relPath));
      }
    } else {
      node.replaceWith(doc.createTextNode(filename));
    }
  }
};

const exportImages = async (
  note: NoteDetail,
  doc: Document,
  exportRoot: string,
  images: ExportAsset[],
) => {
  const dataDir = await getDataDir();
  const usedNames = new Map<string, number>();
  const nodes = Array.from(doc.querySelectorAll("img"));
  for (const img of nodes) {
    const src = img.getAttribute("src") || "";
    if (!src) continue;
    let bytes: Uint8Array | null = null;
    let filename = "image.png";
    const data = decodeDataUrl(src);
    if (data) {
      bytes = data.bytes;
      filename = `image${getExtensionFromMime(data.mime)}`;
    } else {
      const rel = extractRelFromSrc(src);
      if (rel) {
        const filePath = await join(dataDir, "files", rel);
        const raw = await readFileBytes(filePath);
        bytes = Uint8Array.from(raw);
        filename = sanitizeFilename(rel.split("/").pop() || "image.bin");
      }
    }
    if (!bytes) continue;
    const extIdx = filename.lastIndexOf(".");
    const base = extIdx > 0 ? filename.slice(0, extIdx) : filename;
    const ext = extIdx > 0 ? filename.slice(extIdx) : "";
    const uniqueName = ensureUniqueName(base, usedNames, ext);
    const relPath = `images/${note.id}/${uniqueName}`;
    const dest = await ensureDirForFile(exportRoot, relPath);
    await saveBytesAs(dest, bytes);
    images.push({ relPath, filename: uniqueName });
    img.setAttribute("src", relPath);
  }
};

const normalizeNoteHtml = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.body.querySelectorAll("h1").forEach((node) => node.remove());
  return doc;
};

export const buildExportNoteHtml = async (
  note: NoteDetail,
  exportRoot: string,
  idToTitle: Map<number, string>,
) => {
  const doc = normalizeNoteHtml(note.content || "");
  doc.body.querySelectorAll("div.note-code").forEach((node) => {
    const codeEl = node.querySelector("pre > code");
    const codeText = codeEl?.textContent || "";
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    code.textContent = codeText;
    pre.appendChild(code);
    node.replaceWith(pre);
  });
  doc.body.querySelectorAll("div.note-callout").forEach((node) => {
    const pre = doc.createElement("pre");
    pre.textContent = node.textContent || "";
    node.replaceWith(pre);
  });
  doc.body.querySelectorAll("ul[data-en-todo=\"true\"]").forEach((list) => {
    list.removeAttribute("data-en-todo");
    list.querySelectorAll("li").forEach((item) => {
      const checked = item.getAttribute("data-en-checked") === "true";
      item.removeAttribute("data-en-checked");
      const input = doc.createElement("input");
      input.setAttribute("type", "checkbox");
      if (checked) input.setAttribute("checked", "checked");
      const wrapper = doc.createElement("span");
      wrapper.innerHTML = item.innerHTML;
      item.innerHTML = "";
      item.appendChild(input);
      item.appendChild(wrapper);
    });
  });
  replaceNoteLinks(doc.body, idToTitle);
  const attachments: ExportAsset[] = [];
  const images: ExportAsset[] = [];
  await exportAttachments(note, doc, exportRoot, attachments, "html");
  await exportImages(note, doc, exportRoot, images);
  return { content: doc.body.innerHTML, attachments, images };
};

export const buildExportNoteMarkdown = async (
  note: NoteDetail,
  exportRoot: string,
  idToTitle: Map<number, string>,
) => {
  const doc = normalizeNoteHtml(note.content || "");
  replaceNoteLinks(doc.body, idToTitle);
  const attachments: ExportAsset[] = [];
  const images: ExportAsset[] = [];
  await exportAttachments(note, doc, exportRoot, attachments, "text");
  await exportImages(note, doc, exportRoot, images);
  const markdown = htmlToMarkdown(doc.body.innerHTML);
  return { content: markdown, attachments, images };
};

export const prepareExportRoot = async (destDir: string, prefix: string) => {
  const rootName = `${prefix}-export-${formatTimestamp()}`;
  const root = await join(destDir, rootName);
  await ensureDir(root);
  return root;
};

export const writeTextFile = async (root: string, relPath: string, content: string) => {
  const full = await ensureDirForFile(root, relPath);
  await saveBytesAs(full, toUtf8Bytes(content));
};

export const buildNotebookMapForNotes = (notebooks: Notebook[]) => buildNotebookMap(notebooks);
export const buildFolderPath = formatStackNotebookPath;

export type ExportSummary = {
  export_root: string;
  notes: number;
  notebooks: number;
  tags: number;
  attachments: number;
  images: number;
  errors: string[];
};

export const buildNoteFilename = (
  note: NoteDetail,
  used: Map<string, number>,
  ext: string
) => {
  const base = sanitizeFilename(note.title || "Untitled");
  return ensureUniqueName(base, used, ext);
};
