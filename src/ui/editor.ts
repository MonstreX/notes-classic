import { Jodit } from "jodit";
import "jodit/esm/plugins/backspace/backspace.js";
import "jodit/esm/plugins/bold/bold.js";
import "jodit/esm/plugins/clipboard/clipboard.js";
import "jodit/esm/plugins/delete/delete.js";
import "jodit/esm/plugins/drag-and-drop/drag-and-drop.js";
import "jodit/esm/plugins/drag-and-drop-element/drag-and-drop-element.js";
import "jodit/esm/plugins/enter/enter.js";
import "jodit/esm/plugins/focus/focus.js";
import "jodit/esm/plugins/hotkeys/hotkeys.js";
import "jodit/esm/plugins/image/image.js";
import "jodit/esm/plugins/inline-popup/inline-popup.js";
import "jodit/esm/plugins/key-arrow-outside/key-arrow-outside.js";
import "jodit/esm/plugins/link/link.js";
import "jodit/esm/plugins/ordered-list/ordered-list.js";
import "jodit/esm/plugins/paste/paste.js";
import "jodit/esm/plugins/redo-undo/redo-undo.js";
import "jodit/esm/plugins/resize-cells/resize-cells.js";
import "jodit/esm/plugins/resize-handler/resize-handler.js";
import "jodit/esm/plugins/resizer/resizer.js";
import "jodit/esm/plugins/select-cells/select-cells.js";
import "jodit/esm/plugins/tab/tab.js";
import "jodit/esm/plugins/table/table.js";
import "jodit/esm/plugins/font/font.js";
import "jodit/esm/plugins/color/color.js";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import php from "highlight.js/lib/languages/php";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logError } from "../services/logger";
import { decryptHtml, encryptHtml } from "../services/crypto";
import { openConfirmDialog, openPasswordDialog } from "./dialogs";
import { createIcon } from "./icons";
import { importAttachment, importAttachmentBytes, deleteAttachment, readAttachmentText, saveAttachmentAs } from "../services/attachments";
import { downloadNoteFile, storeNoteFileBytes } from "../services/noteFiles";
import { toAssetUrl } from "../services/content";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("php", php);

const DEBUG_CODE = false;

const registerToolbarIcons = () => {
  const set = (name: string, svg: string) => {
    Jodit.modules.Icon.set(name, svg);
  };

  const icon = (paths: string) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  set(
    "bold",
    icon("<path d=\"M6 4h8a4 4 0 0 1 0 8H6z\"></path><path d=\"M6 12h9a4 4 0 0 1 0 8H6z\"></path>")
  );
  set(
    "italic",
    icon("<line x1=\"19\" y1=\"4\" x2=\"10\" y2=\"4\"></line><line x1=\"14\" y1=\"20\" x2=\"5\" y2=\"20\"></line><line x1=\"15\" y1=\"4\" x2=\"9\" y2=\"20\"></line>")
  );
  set(
    "underline",
    icon("<path d=\"M6 3v7a6 6 0 0 0 12 0V3\"></path><line x1=\"4\" y1=\"21\" x2=\"20\" y2=\"21\"></line>")
  );
  set(
    "ul",
    icon("<circle cx=\"4\" cy=\"6\" r=\"1\"></circle><circle cx=\"4\" cy=\"12\" r=\"1\"></circle><circle cx=\"4\" cy=\"18\" r=\"1\"></circle><line x1=\"8\" y1=\"6\" x2=\"21\" y2=\"6\"></line><line x1=\"8\" y1=\"12\" x2=\"21\" y2=\"12\"></line><line x1=\"8\" y1=\"18\" x2=\"21\" y2=\"18\"></line>")
  );
  set(
    "ol",
    icon("<path d=\"M4 6h2\"></path><path d=\"M5 4v4\"></path><path d=\"M4 12h2\"></path><path d=\"M4 12l2 2\"></path><path d=\"M6 14H4\"></path><path d=\"M4 18h2\"></path><line x1=\"8\" y1=\"6\" x2=\"21\" y2=\"6\"></line><line x1=\"8\" y1=\"12\" x2=\"21\" y2=\"12\"></line><line x1=\"8\" y1=\"18\" x2=\"21\" y2=\"18\"></line>")
  );
  set(
    "link",
    icon("<path d=\"M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1\"></path><path d=\"M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1\"></path>")
  );
  set(
    "image",
    icon("<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\" ry=\"2\"></rect><circle cx=\"8\" cy=\"9\" r=\"2\"></circle><path d=\"M21 17l-5-5-4 4-2-2-5 5\"></path>")
  );
  set(
    "undo",
    icon("<path d=\"M9 14l-4-4 4-4\"></path><path d=\"M20 20a8 8 0 0 0-11-10l-4 4\"></path>")
  );
  set(
    "redo",
    icon("<path d=\"M15 14l4-4-4-4\"></path><path d=\"M4 20a8 8 0 0 1 11-10l4 4\"></path>")
  );
  set(
    "callout",
    icon("<path d=\"M4 5h16v10H7l-3 3z\"></path><line x1=\"8\" y1=\"9\" x2=\"16\" y2=\"9\"></line><line x1=\"8\" y1=\"12\" x2=\"13\" y2=\"12\"></line>")
  );
  set(
    "font",
    icon("<path d=\"M4 19h16\"></path><path d=\"M6.5 19L12 5l5.5 14\"></path><path d=\"M8.5 14h7\"></path>")
  );
  set(
    "fontsize",
    icon("<path d=\"M6 19h12\"></path><path d=\"M8 12h8\"></path><path d=\"M9 5h6\"></path>")
  );
  set(
    "brush",
    icon("<path d=\"M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1\"></path><circle cx=\"7.5\" cy=\"9\" r=\"1\"></circle><circle cx=\"10.5\" cy=\"6.5\" r=\"1\"></circle><circle cx=\"15.5\" cy=\"7.5\" r=\"1\"></circle><circle cx=\"17\" cy=\"12\" r=\"1\"></circle>")
  );
  set(
    "todo",
    icon("<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"></rect><path d=\"M8 12l2 2 5-5\"></path>")
  );
  set(
    "codeblock",
    icon("<path d=\"M8 7l-4 5 4 5\"></path><path d=\"M16 7l4 5-4 5\"></path><line x1=\"13\" y1=\"6\" x2=\"11\" y2=\"18\"></line>")
  );
  set(
    "attach",
    icon("<path d=\"M21.44 11.05 12.95 19.54a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.5 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78\"></path>")
  );
  set(
    "encrypt",
    icon("<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"></rect><path d=\"M8 11V7a4 4 0 0 1 8 0v4\"></path>")
  );
  set(
    "table",
    icon("<rect x=\"4\" y=\"5\" width=\"16\" height=\"14\" rx=\"1\"></rect><line x1=\"4\" y1=\"10\" x2=\"20\" y2=\"10\"></line><line x1=\"4\" y1=\"15\" x2=\"20\" y2=\"15\"></line><line x1=\"10\" y1=\"5\" x2=\"10\" y2=\"19\"></line><line x1=\"15\" y1=\"5\" x2=\"15\" y2=\"19\"></line>")
  );
};

export type EditorInstance = {
  update: (content: string) => void;
  destroy: () => void;
};

type EditorOptions = {
  content: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  getNoteId?: () => number | null;
};

const findCallout = (node: Node | null, root: HTMLElement) => {
  let current = node;
  while (current && current !== root) {
    if (current.nodeType === 1 && (current as HTMLElement).classList.contains("note-callout")) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
};

const findCodeBlock = (node: Node | null, root: HTMLElement) => {
  let current = node;
  while (current && current !== root) {
    if (current.nodeType === 1 && (current as HTMLElement).classList.contains("note-code")) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
};

const findSecureBlock = (node: Node | null, root: HTMLElement) => {
  let current = node;
  while (current && current !== root) {
    if (current.nodeType === 1 && (current as HTMLElement).classList.contains("note-secure")) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
};

const fragmentHasContent = (fragment: DocumentFragment) => {
  if (fragment.textContent && fragment.textContent.trim().length > 0) return true;
  return !!fragment.querySelector("img,table,ul,ol,li,hr,pre,blockquote,.note-attachment,.note-secure");
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : size < 10 ? 1 : 0;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const extensionFromMime = (mime: string) => {
  const lower = mime.toLowerCase();
  if (lower === "image/png") return "png";
  if (lower === "image/jpeg") return "jpg";
  if (lower === "image/gif") return "gif";
  if (lower === "image/webp") return "webp";
  if (lower === "image/svg+xml") return "svg";
  return "bin";
};

const dataUrlToBytes = (dataUrl: string) => {
  const [meta, data] = dataUrl.split(",", 2);
  const mimeMatch = meta?.match(/data:([^;]+)/i);
  const mime = mimeMatch?.[1] || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta || "");
  let binary = "";
  if (isBase64) {
    binary = atob(data || "");
  } else {
    binary = decodeURIComponent(data || "");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
};

const shouldConvertImageSrc = (src: string) => {
  if (!src) return false;
  if (src.startsWith("notes-file://")) return false;
  if (src.startsWith("files/")) return false;
  if (src.startsWith("asset://")) return false;
  if (src.startsWith("tauri://")) return false;
  if (src.startsWith("http://asset.localhost/")) return false;
  if (src.startsWith("https://asset.localhost/")) return false;
  return true;
};

const isTextAttachment = (name: string, mime: string) => {
  if (mime.startsWith("text/")) return true;
  const lower = name.toLowerCase();
  return [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".xml",
    ".csv",
    ".log",
    ".yaml",
    ".yml",
    ".ini",
    ".js",
    ".ts",
    ".css",
    ".html",
    ".htm",
    ".rs",
    ".py",
    ".php",
  ].some((ext) => lower.endsWith(ext));
};

const isRangeAtStart = (callout: HTMLElement, range: Range) => {
  const test = range.cloneRange();
  test.selectNodeContents(callout);
  test.setEnd(range.startContainer, range.startOffset);
  return !fragmentHasContent(test.cloneContents());
};

const isRangeAtEnd = (callout: HTMLElement, range: Range) => {
  const test = range.cloneRange();
  test.selectNodeContents(callout);
  test.setStart(range.endContainer, range.endOffset);
  return !fragmentHasContent(test.cloneContents());
};

const isCalloutEmpty = (callout: HTMLElement) => {
  if (callout.textContent && callout.textContent.trim().length > 0) return false;
  return !callout.querySelector("img,table,ul,ol,li,hr,pre,blockquote,.note-attachment,.note-secure");
};

const isBlockEmpty = (block: HTMLElement) => {
  if (block.textContent && block.textContent.trim().length > 0) return false;
  return !block.querySelector("img,table,ul,ol,li,hr,pre,blockquote,code,.note-attachment,.note-secure");
};

const extractTextWithLineBreaks = (fragment: DocumentFragment) => {
  const temp = document.createElement("div");
  temp.appendChild(fragment);
  temp.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  temp.querySelectorAll("p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6").forEach((el) => {
    if (el.lastChild && el.lastChild.nodeType === Node.TEXT_NODE && el.lastChild.textContent?.endsWith("\n")) {
      return;
    }
    el.appendChild(document.createTextNode("\n"));
  });
  const raw = temp.textContent || "";
  return raw.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
};

const extractCodeText = (code: HTMLElement, mutate: boolean) => {
  const clone = code.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-jodit-selection_marker]").forEach((el) => el.remove());
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const raw = clone.textContent || "";
  const text = raw.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  if (mutate) {
    code.textContent = text;
  }
  return text;
};

const applyHighlightToEditor = (editor: any) => {
  if (!editor || !editor.editor) return;
  if (DEBUG_CODE) {
    console.log("[note-code] highlight run", {
      blocks: editor.editor.querySelectorAll(".note-code").length,
    });
  }
  editor.editor.querySelectorAll(".note-code").forEach((block: HTMLElement) => {
    const code = block.querySelector("code") as HTMLElement | null;
    if (!code) return;
    const lang = block.getAttribute("data-lang") || "auto";
    const text = extractCodeText(code, true);
    if (DEBUG_CODE) {
      console.log("[note-code] block", {
        lang,
        textLength: text.length,
        sample: text.slice(0, 80),
      });
    }
    if (!text.trim()) return;
    if (lang !== "auto") {
      const mapped = lang === "js" ? "javascript" : lang === "html" ? "xml" : lang;
      try {
        const result = hljs.highlight(text, { language: mapped });
        code.innerHTML = result.value;
        code.className = `hljs language-${mapped}`;
      } catch (e) {
        logError("[note-code] highlight failed", e);
      }
      return;
    }
    try {
      const result = hljs.highlightAuto(text, ["php", "html", "javascript", "css"]);
      code.innerHTML = result.value;
      code.className = result.language ? `hljs language-${result.language}` : "hljs";
    } catch (e) {
      logError("[note-code] auto highlight failed", e);
    }
  });
};

const buildSecureNode = (editor: any, payload: { cipher: string; salt: string; iv: string; iterations: number }) => {
  const wrapper = editor.createInside.element("div");
  wrapper.className = "note-secure";
  wrapper.setAttribute("data-secure", "1");
  wrapper.setAttribute("data-alg", "aes-gcm");
  wrapper.setAttribute("data-kdf", "pbkdf2");
  wrapper.setAttribute("data-iter", String(payload.iterations));
  wrapper.setAttribute("data-salt", payload.salt);
  wrapper.setAttribute("data-iv", payload.iv);
  wrapper.setAttribute("data-cipher", payload.cipher);
  wrapper.setAttribute("data-ver", "1");
  wrapper.setAttribute("contenteditable", "false");

  const handle = editor.createInside.element("span");
  handle.className = "note-secure__handle";

  const icon = createIcon("icon-lock", "note-secure__icon");
  handle.appendChild(icon);

  const dots = editor.createInside.element("span");
  dots.className = "note-secure__dots";
  for (let i = 0; i < 5; i += 1) {
    const dot = editor.createInside.element("span");
    dot.className = "note-secure__dot";
    dots.appendChild(dot);
  }
  handle.appendChild(dots);

  wrapper.appendChild(handle);
  return wrapper;
};

const buildAttachmentNode = (
  editor: any,
  attachment: { id: number; filename: string; size: number; mime: string }
) => {
  const wrapper = editor.createInside.element("div");
  wrapper.className = "note-attachment";
  wrapper.setAttribute("data-attachment-id", String(attachment.id));
  wrapper.setAttribute("data-attachment-name", attachment.filename);
  wrapper.setAttribute("data-attachment-size", String(attachment.size));
  wrapper.setAttribute("data-attachment-mime", attachment.mime);
  wrapper.setAttribute("contenteditable", "false");

  const main = editor.createInside.element("div");
  main.className = "note-attachment__main";
  const icon = createIcon("icon-attach", "note-attachment__icon");
  const meta = editor.createInside.element("div");
  meta.className = "note-attachment__meta";
  const name = editor.createInside.element("span");
  name.className = "note-attachment__name";
  name.textContent = attachment.filename;
  const size = editor.createInside.element("span");
  size.className = "note-attachment__size";
  size.textContent = formatBytes(attachment.size);
  meta.appendChild(name);
  meta.appendChild(size);
  main.appendChild(icon);
  main.appendChild(meta);

  const actions = editor.createInside.element("div");
  actions.className = "note-attachment__actions";
  actions.setAttribute("contenteditable", "false");

  const download = editor.createInside.element("button");
  download.className = "note-attachment__action";
  download.setAttribute("data-attachment-action", "download");
  download.type = "button";
  download.textContent = "Download";

  const openBtn = editor.createInside.element("button");
  openBtn.className = "note-attachment__action";
  openBtn.setAttribute("data-attachment-action", "open");
  openBtn.type = "button";
  openBtn.textContent = "View";
  if (!isTextAttachment(attachment.filename, attachment.mime)) {
    openBtn.classList.add("is-hidden");
  }

  const remove = editor.createInside.element("button");
  remove.className = "note-attachment__action note-attachment__action--danger";
  remove.setAttribute("data-attachment-action", "delete");
  remove.type = "button";
  remove.textContent = "Delete";

  actions.appendChild(download);
  actions.appendChild(openBtn);
  actions.appendChild(remove);

  wrapper.appendChild(main);
  wrapper.appendChild(actions);
  return wrapper;
};

const openAttachmentPreview = (title: string, content: string) => {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.dataset.dialogOverlay = "1";

  overlay.innerHTML = `
    <div class="dialog attachment-dialog">
      <div class="dialog__header">
        <h3 class="dialog__title"></h3>
      </div>
      <div class="dialog__body">
        <pre class="attachment-dialog__content"></pre>
      </div>
      <div class="dialog__footer">
        <button class="dialog__button dialog__button--primary" data-attachment-close="1">Close</button>
      </div>
    </div>
  `;

  const titleEl = overlay.querySelector(".dialog__title") as HTMLElement | null;
  if (titleEl) {
    titleEl.textContent = title;
  }
  const pre = overlay.querySelector(".attachment-dialog__content") as HTMLElement | null;
  if (pre) {
    pre.textContent = content;
  }

  const cleanup = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cleanup();
  });
  overlay.querySelector("[data-attachment-close]")?.addEventListener("click", cleanup);
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") cleanup();
    },
    { once: true }
  );

  document.body.appendChild(overlay);
};

const openSecureEditor = (html: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    overlay.innerHTML = `
      <div class="dialog secure-dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">Encrypted content</h3>
        </div>
        <div class="dialog__body">
          <div class="secure-dialog__content">
            <div class="notes-editor notes-editor--preview">
              <div class="jodit-wysiwyg" contenteditable="true"></div>
            </div>
          </div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-secure-cancel="1">Cancel</button>
          <button class="dialog__button dialog__button--primary" data-secure-save="1">Save</button>
        </div>
      </div>
    `;

    const content = overlay.querySelector(".secure-dialog__content .jodit-wysiwyg") as HTMLElement | null;
    if (content) {
      content.innerHTML = html;
      content.focus();
    }

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });
    overlay.querySelector("[data-secure-cancel]")?.addEventListener("click", () => cleanup(null));
    overlay.querySelector("[data-secure-save]")?.addEventListener("click", () => cleanup(content?.innerHTML ?? ""));
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") cleanup(null);
      },
      { once: true }
    );

    document.body.appendChild(overlay);
  });
};

const setupCodeToolbarHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteCodeSetup) return;
  (editor as any).__noteCodeSetup = true;

  if (DEBUG_CODE) {
    console.log("[note-code] attach");
  }

  editor.editor.addEventListener(
    "change",
    (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.classList.contains("note-code-select")) {
        const block = target.closest(".note-code") as HTMLElement | null;
        if (!block) return;
        const lang = (target as HTMLSelectElement).value;
        block.setAttribute("data-lang", lang);
        applyHighlightToEditor(editor);
      }
    },
    true
  );

  editor.editor.addEventListener(
    "click",
    async (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.classList.contains("note-code-copy")) {
        const block = target.closest(".note-code") as HTMLElement | null;
        if (!block) return;
        const code = block.querySelector("code") as HTMLElement | null;
        if (!code) return;
        const text = extractCodeText(code, false);
        if (!text) return;
        try {
          await writeText(text);
          return;
        } catch (e) {
          logError("[note-code] copy failed", e);
        }
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          logError("[note-code] clipboard fallback failed", e);
        }
      }
    },
    true
  );
};

const setupSecureHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteSecureSetup) return;
  (editor as any).__noteSecureSetup = true;

  editor.editor.addEventListener(
    "click",
    async (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const block = target.closest(".note-secure") as HTMLElement | null;
      if (!block) return;
      const cipher = block.getAttribute("data-cipher");
      const salt = block.getAttribute("data-salt");
      const iv = block.getAttribute("data-iv");
      const iterRaw = block.getAttribute("data-iter");
      if (!cipher || !salt || !iv || !iterRaw) return;
      event.preventDefault();
      event.stopPropagation();
      const password = await openPasswordDialog({
        title: "Unlock content",
        message: "Enter password",
        confirmLabel: "Unlock",
        cancelLabel: "Cancel",
      });
      if (!password) return;
      try {
        const html = await decryptHtml(
          {
            cipher,
            salt,
            iv,
            iterations: Number(iterRaw),
          },
          password
        );
        const updated = await openSecureEditor(html);
        if (updated === null) return;
        const payload = await encryptHtml(updated, password);
        block.setAttribute("data-iter", String(payload.iterations));
        block.setAttribute("data-salt", payload.salt);
        block.setAttribute("data-iv", payload.iv);
        block.setAttribute("data-cipher", payload.cipher);
        editor.synchronizeValues();
      } catch (e) {
        logError("[note-secure] decrypt failed", e);
        alert("Invalid password or corrupted content.");
      }
    },
    true
  );
};

const setupTodoHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteTodoSetup) return;
  (editor as any).__noteTodoSetup = true;

  editor.editor.addEventListener(
    "click",
    (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const selection = editor.s?.range;
      if (!selection || !editor.s.isCollapsed()) return;
      const li = target.closest("li") as HTMLElement | null;
      if (!li) return;
      const list = li.closest("ul") as HTMLElement | null;
      if (!list || list.getAttribute("data-en-todo") !== "true") return;
      if (target.closest("a,button,input,select,textarea")) return;
      const current = li.getAttribute("data-en-checked") === "true";
      li.setAttribute("data-en-checked", current ? "false" : "true");
      editor.synchronizeValues();
    },
    true
  );
};

const setupLinkHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteLinkSetup) return;
  (editor as any).__noteLinkSetup = true;

  editor.editor.addEventListener(
    "click",
    async (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        await openShell(href);
      } catch (e) {
        logError("[note-link] open failed", e);
      }
    },
    true
  );
};

const setupAttachmentHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteAttachmentSetup) return;
  (editor as any).__noteAttachmentSetup = true;

  editor.editor.addEventListener(
    "click",
    async (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const actionEl = target.closest<HTMLElement>("[data-attachment-action]");
      if (!actionEl) return;
      const wrapper = target.closest<HTMLElement>(".note-attachment");
      if (!wrapper) return;
      const idRaw = wrapper.dataset.attachmentId;
      const name = wrapper.dataset.attachmentName || "attachment";
      const mime = wrapper.dataset.attachmentMime || "";
      if (!idRaw) return;
      const id = Number(idRaw);
      if (!Number.isFinite(id)) return;
      const action = actionEl.dataset.attachmentAction;
      event.preventDefault();
      event.stopPropagation();

      if (action === "download") {
        const dest = await saveDialog({ defaultPath: name });
        if (!dest) return;
        try {
          await saveAttachmentAs(id, dest);
        } catch (e) {
          logError("[attachment] save failed", e);
        }
        return;
      }

      if (action === "open") {
        if (!isTextAttachment(name, mime)) {
          return;
        }
        try {
          const content = await readAttachmentText(id, 1024 * 1024);
          openAttachmentPreview(name, content);
        } catch (e) {
          logError("[attachment] preview failed", e);
        }
        return;
      }

      if (action === "delete") {
        const ok = await openConfirmDialog({
          title: "Delete attachment",
          message: "Remove this attachment from the note?",
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        let removed = false;
        try {
          await deleteAttachment(id);
          removed = true;
        } catch (e) {
          logError("[attachment] delete failed", e);
        }
        if (removed) {
          wrapper.remove();
          editor.synchronizeValues();
        }
      }
    },
    true
  );
};

const setupAttachmentDrop = (editor: any, getNoteId?: () => number | null) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__noteAttachmentDropSetup) return;
  (editor as any).__noteAttachmentDropSetup = true;

  const insertAttachmentNode = (attachment: { id: number; filename: string; size: number; mime: string }) => {
    const node = buildAttachmentNode(editor, attachment);
    editor.s.insertNode(node);
    editor.s.setCursorAfter(node);
    if (typeof editor.synchronizeValues === "function") {
      editor.synchronizeValues();
    } else if (typeof editor.s?.synchronizeValues === "function") {
      editor.s.synchronizeValues();
    } else if (typeof editor?.s?.sync === "function") {
      editor.s.sync();
    } else {
      editor.events?.fire?.("change");
    }
  };

  const handleFiles = async (files: FileList, clientX: number, clientY: number) => {
    const noteId = getNoteId?.();
    if (!noteId) return;
    if (editor.s?.setCursorByXy) {
      editor.s.setCursorByXy(clientX, clientY);
    }
    for (const file of Array.from(files)) {
      const path = (file as any).path as string | undefined;
      try {
        if (path) {
          const attachment = await importAttachment(noteId, path);
          insertAttachmentNode({
            id: attachment.id,
            filename: attachment.filename,
            size: attachment.size,
            mime: attachment.mime,
          });
          continue;
        }
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const attachment = await importAttachmentBytes(
          noteId,
          file.name,
          file.type || "",
          bytes
        );
        insertAttachmentNode({
          id: attachment.id,
          filename: attachment.filename,
          size: attachment.size,
          mime: attachment.mime,
        });
      } catch (e) {
        logError("[attachment] import failed", e);
      }
    }
  };

  const handlePaths = async (paths: string[], clientX: number, clientY: number) => {
    const noteId = getNoteId?.();
    if (!noteId) return;
    if (editor.s?.setCursorByXy) {
      editor.s.setCursorByXy(clientX, clientY);
    }
    for (const path of paths) {
      try {
        const attachment = await importAttachment(noteId, path);
        insertAttachmentNode({
          id: attachment.id,
          filename: attachment.filename,
          size: attachment.size,
          mime: attachment.mime,
        });
      } catch (e) {
        logError("[attachment] import failed", e);
      }
    }
  };

  const targets: HTMLElement[] = [];
  if (editor.editor) targets.push(editor.editor);
  if (editor.container) targets.push(editor.container);
  if (editor.workplace) targets.push(editor.workplace);

  const hasFiles = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes("Files")) return true;
    return !!event.dataTransfer?.files?.length;
  };

  const windowHandle = getCurrentWindow();
  windowHandle.onDragDropEvent((event) => {
    if (event.type !== "drop") return;
    const paths = event.paths || [];
    if (!paths.length) return;
    const position = event.position;
    if (position) {
      const el = document.elementFromPoint(position.x, position.y);
      const targetWithin = !!el && (editor.container?.contains(el) || editor.editor?.contains(el));
      if (!targetWithin) return;
      handlePaths(paths, position.x, position.y);
      return;
    }
    handlePaths(paths, 0, 0);
  }).then((unlisten) => {
    (editor as any).__noteAttachmentUnlisten = unlisten;
  });

  targets.forEach((target) => {
    target.addEventListener("dragenter", (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    });
    target.addEventListener("dragover", (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    });

    target.addEventListener("drop", (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      event.stopPropagation();
      handleFiles(event.dataTransfer.files, event.clientX, event.clientY);
    });
  });
};

const setupPasteImageHandlers = (editor: any) => {
  if (!editor || !editor.editor) return;
  if ((editor as any).__notePasteSetup) return;
  (editor as any).__notePasteSetup = true;

  const syncEditor = () => {
    if (typeof editor.synchronizeValues === "function") {
      editor.synchronizeValues();
    } else if (typeof editor.s?.synchronizeValues === "function") {
      editor.s.synchronizeValues();
    } else if (typeof editor?.s?.sync === "function") {
      editor.s.sync();
    } else {
      editor.events?.fire?.("change");
    }
  };

  const insertImages = async (images: Array<{ filename: string; mime: string; bytes: Uint8Array }>) => {
    for (const image of images) {
      try {
        const stored = await storeNoteFileBytes(image.filename, image.mime, image.bytes);
        const assetUrl = await toAssetUrl(stored.rel_path);
        const paragraph = editor.createInside.element("p");
        const img = editor.createInside.element("img");
        img.setAttribute("src", assetUrl);
        img.setAttribute("data-en-hash", stored.hash);
        paragraph.appendChild(img);
        editor.s.insertNode(paragraph);
        editor.s.setCursorAfter(paragraph);
      } catch (e) {
        logError("[paste] image store failed", e);
      }
    }
    syncEditor();
  };

  const cleanupImageAttrs = (img: HTMLImageElement) => {
    img.removeAttribute("srcset");
    img.removeAttribute("data-src");
    img.removeAttribute("data-src-pb");
    img.removeAttribute("data-original");
    img.removeAttribute("data-original-src");
  };

  const convertImageElement = async (img: HTMLImageElement) => {
    if (img.dataset.noteImagePending === "1") return;
    const src = img.getAttribute("src") || "";
    if (!shouldConvertImageSrc(src)) return;
    img.dataset.noteImagePending = "1";
    try {
      if (src.startsWith("data:")) {
        const payload = dataUrlToBytes(src);
        const filename = `pasted-image-${Date.now()}.${extensionFromMime(payload.mime)}`;
        const stored = await storeNoteFileBytes(filename, payload.mime, payload.bytes);
        const assetUrl = await toAssetUrl(stored.rel_path);
        img.setAttribute("src", assetUrl);
        img.setAttribute("data-en-hash", stored.hash);
        cleanupImageAttrs(img);
        return;
      }
      if (src.startsWith("http://") || src.startsWith("https://")) {
        const stored = await downloadNoteFile(src);
        const assetUrl = await toAssetUrl(stored.rel_path);
        img.setAttribute("src", assetUrl);
        img.setAttribute("data-en-hash", stored.hash);
        cleanupImageAttrs(img);
        return;
      }
      img.remove();
    } catch (e) {
      logError("[paste] image convert failed", e);
      img.remove();
    } finally {
      delete img.dataset.noteImagePending;
    }
  };

  const convertImagesInEditor = async () => {
    if (!editor.editor) return;
    const images = Array.from(editor.editor.querySelectorAll("img"));
    for (const img of images) {
      await convertImageElement(img);
    }
    syncEditor();
  };

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const html = clipboard.getData("text/html");
    const items = Array.from(clipboard.items || []);
    const imageItems = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    const hasHtmlImages = !!html && /<img[\s>]/i.test(html);
    if (!hasHtmlImages && imageItems.length === 0) {
      window.setTimeout(() => {
        convertImagesInEditor().catch((e) => logError("[paste] scan failed", e));
      }, 0);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (hasHtmlImages && html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const images = Array.from(doc.querySelectorAll("img"));
      for (const img of images) {
        const src = img.getAttribute("src") || "";
        await convertImageElement(img);
      }
      editor.s.insertHTML(doc.body.innerHTML);
      syncEditor();
      window.setTimeout(() => {
        convertImagesInEditor().catch((e) => logError("[paste] scan failed", e));
      }, 0);
      return;
    }

    if (imageItems.length > 0) {
      const images = await Promise.all(
        imageItems.map(async (file, index) => {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const mime = file.type || "image/png";
          const filename = file.name || `pasted-image-${Date.now()}-${index}.${extensionFromMime(mime)}`;
          return { filename, mime, bytes };
        })
      );
      await insertImages(images);
      window.setTimeout(() => {
        convertImagesInEditor().catch((e) => logError("[paste] scan failed", e));
      }, 0);
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    handlePaste(event).catch((e) => logError("[paste] failed", e));
  };
  editor.editor.addEventListener("paste", onPaste);
  editor.container?.addEventListener("paste", onPaste, true);
  editor.workplace?.addEventListener("paste", onPaste, true);
};

const createEditorConfig = (overrides: Record<string, unknown> = {}, getNoteId?: () => number | null) => {
  registerToolbarIcons();
  return {
    readonly: false,
    toolbarAdaptive: false,
    iframe: false,
    statusbar: false,
    spellcheck: true,
    showCharsCounter: false,
    showWordsCounter: false,
    showXPathInStatusbar: false,
    autofocus: false,
    askBeforePasteHTML: false,
    askBeforePasteFromWord: false,
    enter: "P",
    buttons: [
      "bold",
      "italic",
      "underline",
      "font",
      "fontsize",
      "brush",
      "|",
      "ul",
      "ol",
      "table",
      "callout",
      "todo",
      "codeblock",
      "attach",
      "encrypt",
      "|",
      "undo",
      "redo",
    ],
    buttonsMD: [
      "bold",
      "italic",
      "underline",
      "font",
      "fontsize",
      "brush",
      "|",
      "ul",
      "ol",
      "table",
      "callout",
      "todo",
      "codeblock",
      "attach",
      "encrypt",
      "|",
      "undo",
      "redo",
    ],
    buttonsSM: [
      "bold",
      "italic",
      "font",
      "fontsize",
      "brush",
      "|",
      "ul",
      "ol",
      "table",
      "callout",
      "todo",
      "codeblock",
      "attach",
      "encrypt",
      "|",
      "undo",
      "redo",
    ],
    buttonsXS: [
      "bold",
      "italic",
      "font",
      "fontsize",
      "brush",
      "|",
      "ul",
      "ol",
      "table",
      "callout",
      "todo",
      "codeblock",
      "attach",
      "encrypt",
      "|",
      "undo",
      "redo",
    ],
    commandToHotkeys: {
      callout: "ctrl+l",
    },
    controls: {
      callout: {
        tooltip: "Callout",
        text: "",
        icon: "callout",
        exec: (editor: any) => {
          if (!editor || !editor.s || editor.s.isCollapsed()) return;
          const range = editor.s.range;
          const isInsideCallout = (node: Node | null) => {
            let current = node;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1 && (current as HTMLElement).classList.contains("note-callout")) {
                return true;
              }
              current = current.parentNode;
            }
            return false;
          };
          if (isInsideCallout(range.startContainer) || isInsideCallout(range.endContainer)) return;
          const wrapper = editor.createInside.element("div");
          wrapper.className = "note-callout";
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);
          editor.s.setCursorAfter(wrapper);
          editor.s.synchronizeValues();
        },
      },
      todo: {
        tooltip: "Todo List",
        text: "",
        icon: "todo",
        exec: (editor: any) => {
          if (!editor || !editor.s) return;
          const range = editor.s.range;
          const findList = (node: Node | null) => {
            let current = node as HTMLElement | null;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1) {
                const tag = current.tagName?.toLowerCase();
                if (tag === "ul" || tag === "ol") return current;
              }
              current = current.parentElement;
            }
            return null;
          };

          let list = findList(range.startContainer);
          if (!list) {
            editor.execCommand("insertUnorderedList");
            list = findList(range.startContainer);
          }
          if (!list) return;

          if (list.tagName.toLowerCase() === "ol") {
            const ul = editor.createInside.element("ul");
            while (list.firstChild) {
              ul.appendChild(list.firstChild);
            }
            list.parentNode?.replaceChild(ul, list);
            list = ul;
          }

          list.setAttribute("data-en-todo", "true");
          list.querySelectorAll("li").forEach((li) => {
            if (!li.hasAttribute("data-en-checked")) {
              li.setAttribute("data-en-checked", "false");
            }
          });
          editor.synchronizeValues();
        },
      },
      codeblock: {
        tooltip: "Code Block",
        text: "",
        icon: "codeblock",
        exec: (editor: any) => {
          if (!editor || !editor.s || editor.s.isCollapsed()) return;
          const range: Range = editor.s.range;
          const isInsideBlock = (node: Node | null) => {
            let current = node;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1) {
                const el = current as HTMLElement;
                if (el.classList.contains("note-code") || el.classList.contains("note-callout")) {
                  return true;
                }
              }
              current = current.parentNode;
            }
            return false;
          };
          if (isInsideBlock(range.startContainer) || isInsideBlock(range.endContainer)) return;
          const fragment = range.extractContents();
          const text = extractTextWithLineBreaks(fragment);
          if (!text.trim()) return;
          const wrapper = editor.createInside.element("div");
          wrapper.className = "note-code";
          wrapper.setAttribute("data-lang", "auto");

          const toolbar = editor.createInside.element("div");
          toolbar.className = "note-code-toolbar";
          toolbar.setAttribute("contenteditable", "false");

          const select = editor.createInside.element("select");
          select.className = "note-code-select";
          const langs = ["auto", "php", "html", "js", "css"];
          langs.forEach((lang) => {
            const opt = editor.createInside.element("option");
            opt.value = lang;
            opt.textContent = lang.toUpperCase();
            if (lang === "auto") opt.selected = true;
            select.appendChild(opt);
          });

          const button = editor.createInside.element("button");
          button.className = "note-code-copy";
          button.type = "button";
          button.textContent = "Copy";

          toolbar.appendChild(select);
          toolbar.appendChild(button);

          const pre = editor.createInside.element("pre");
          const code = editor.createInside.element("code");
          code.textContent = text;
          pre.appendChild(code);

          wrapper.appendChild(toolbar);
          wrapper.appendChild(pre);

          range.insertNode(wrapper);
          editor.s.setCursorIn(code);
          editor.s.synchronizeValues();
          applyHighlightToEditor(editor);
        },
      },
      attach: {
        tooltip: "Attach file",
        text: "",
        icon: "attach",
        exec: async (editor: any) => {
          const noteId = getNoteId?.();
          if (!noteId) return;
          const selection = await openDialog({
            multiple: false,
            directory: false,
          });
          if (!selection || Array.isArray(selection)) return;
          try {
            const attachment = await importAttachment(noteId, selection);
            const node = buildAttachmentNode(editor, {
              id: attachment.id,
              filename: attachment.filename,
              size: attachment.size,
              mime: attachment.mime,
            });
            editor.s.insertNode(node);
            editor.s.setCursorAfter(node);
            editor.s.synchronizeValues();
          } catch (e) {
            logError("[attachment] import failed", e);
          }
        },
      },
      encrypt: {
        tooltip: "Encrypt",
        text: "",
        icon: "encrypt",
        exec: async (editor: any) => {
          if (!editor || !editor.s || editor.s.isCollapsed()) return;
          const range: Range = editor.s.range;
          const isInsideBlock = (node: Node | null) => {
            let current = node;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1) {
                const el = current as HTMLElement;
                if (el.classList.contains("note-secure")) return true;
              }
              current = current.parentNode;
            }
            return false;
          };
          if (isInsideBlock(range.startContainer) || isInsideBlock(range.endContainer)) return;

          const selectionRange = range.cloneRange();
          const fragment = selectionRange.cloneContents();
          const container = document.createElement("div");
          container.appendChild(fragment);
          const html = container.innerHTML.trim();
          if (!html) return;

          const password = await openPasswordDialog({
            title: "Encrypt selection",
            message: "Enter password",
            confirmLabel: "Encrypt",
            cancelLabel: "Cancel",
          });
          if (!password) return;

          try {
            const payload = await encryptHtml(html, password);
            const secureNode = buildSecureNode(editor, payload);
            const selection = editor.s?.sel;
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(selectionRange);
            }
            selectionRange.deleteContents();
            selectionRange.insertNode(secureNode);
            editor.s.setCursorAfter(secureNode);
            editor.s.synchronizeValues();
          } catch (e) {
            logError("[note-secure] encrypt failed", e);
          }
        },
      },
    },
    cleanHTML: {
      fillEmptyParagraph: false,
      removeEmptyElements: false,
    },
    style: {
      minHeight: "500px",
    },
    allowResizeTags: new Set(["img", "table"]),
    tableAllowCellResize: true,
    resizer: {
      showSize: true,
      forImageChangeAttributes: true,
      min_width: 10,
      min_height: 10,
      useAspectRatio: new Set(["img"]),
    },
    extraPlugins: ["resizer", "resize-cells"],
    events: {
      keydown: function (event: KeyboardEvent) {
        const editor: any = this;
        if (!editor || !editor.s) return;
        if (event.key !== "Enter" && event.key !== "Backspace" && event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Delete") return;
        if (!editor.s.range || !editor.s.isCollapsed()) return;

        if (event.key === "Enter") {
          const insideCallout = findCallout(editor.s.range.startContainer, editor.editor);
          const insideCode = findCodeBlock(editor.s.range.startContainer, editor.editor);
          if (!insideCallout && !insideCode) {
            const startNode = editor.s.range.startContainer;
            const textNode = startNode.nodeType === Node.TEXT_NODE ? (startNode as Text) : null;
            if (textNode) {
              const nodeText = (textNode.textContent || "").replace(/\uFEFF/g, "").replace(/\u00a0/g, " ").trim();
              const atEnd = editor.s.range.startOffset === (textNode.textContent?.length || 0);
              if (atEnd && /^-{3,}$/.test(nodeText)) {
                const range = editor.s.range;
                range.setStart(textNode, 0);
                range.setEnd(textNode, textNode.textContent?.length || 0);
                range.deleteContents();
                editor.s.insertHTML("<hr><p><br></p>");
                editor.s.synchronizeValues();
                event.preventDefault();
                event.stopPropagation();
                return false;
              }
            }
          }
        }

        const callout = findCallout(editor.s.range.startContainer, editor.editor);
        const codeBlock = findCodeBlock(editor.s.range.startContainer, editor.editor);
        const block = codeBlock || callout;
        if (!block) return;

        const range: Range = editor.s.range;

        if (event.key === "Enter") {
          if (codeBlock) {
            const textNode = editor.createInside.text("\n");
            range.deleteContents();
            range.insertNode(textNode);
            editor.s.setCursorAfter(textNode);
            editor.s.synchronizeValues();
            event.preventDefault();
            event.stopPropagation();
            return false;
          }
          const block = editor.createInside.element(editor.o.enter || "p");
          block.innerHTML = "<br>";
          range.deleteContents();
          range.insertNode(block);
          editor.s.setCursorIn(block);
          editor.s.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === "Backspace" && isRangeAtStart(block, range)) {
          editor.s.setCursorBefore(block);
          block.remove();
          editor.s.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === "Delete" && isRangeAtEnd(block, range)) {
          editor.s.setCursorAfter(block);
          block.remove();
          editor.s.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === "ArrowDown" && isRangeAtEnd(block, range)) {
          editor.s.setCursorAfter(block);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === "ArrowUp" && isRangeAtStart(block, range)) {
          editor.s.setCursorBefore(block);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      },
      keyup: function () {
        const editor: any = this;
        if (!editor || !editor.s || !editor.s.range) return;
        const callout = findCallout(editor.s.range.startContainer, editor.editor);
        const codeBlock = findCodeBlock(editor.s.range.startContainer, editor.editor);
        const block = codeBlock || callout;
        if (!block) return;
        if (isBlockEmpty(block)) {
          editor.s.setCursorBefore(block);
          block.remove();
          editor.s.synchronizeValues();
        }
      },
      blur: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        applyHighlightToEditor(editor);
      },
      afterSetValue: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        window.setTimeout(() => {
          applyHighlightToEditor(editor);
        }, 0);
      },
      change: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        const selection = editor.s?.range;
        const active = selection ? (findCodeBlock(selection.startContainer, editor.editor) || findCallout(selection.startContainer, editor.editor)) : null;
        if (active && isBlockEmpty(active)) {
          active.remove();
          editor.s.synchronizeValues();
        }
        if (!selection || !findCodeBlock(selection.startContainer, editor.editor)) {
          applyHighlightToEditor(editor);
        }
      },
    },
    ...overrides,
  };
};

export const mountEditor = (root: HTMLElement, options: EditorOptions): EditorInstance => {
  const container = document.createElement("div");
  container.className = "notes-editor";
  const editorWrapper = document.createElement("div");
  editorWrapper.className = "notes-editor__wrapper";
  const mountPoint = document.createElement("div");
  editorWrapper.appendChild(mountPoint);
  container.appendChild(editorWrapper);
  root.appendChild(container);

  const editor = new Jodit(mountPoint, createEditorConfig({}, options.getNoteId));
  editor.value = options.content || "";

  let isUpdating = false;
  let lastEmittedValue = editor.value;
  const handleChange = () => {
    if (isUpdating) return;
    const value = editor.value;
    if (value === lastEmittedValue) return;
    lastEmittedValue = value;
    options.onChange(value);
  };

  setupCodeToolbarHandlers(editor);
  setupSecureHandlers(editor);
  setupAttachmentHandlers(editor);
  setupAttachmentDrop(editor, options.getNoteId);
  setupPasteImageHandlers(editor);
  setupTodoHandlers(editor);
  setupLinkHandlers(editor);
  applyHighlightToEditor(editor);

  const handleFocus = () => {
    options.onFocus?.();
  };
  const handleBlur = () => {
    options.onBlur?.();
  };

  editor.events.on("change", handleChange);
  editor.events.on("focus", handleFocus);
  editor.events.on("blur", handleBlur);
  editor.events.on("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    const range = editor.s?.range;
    if (!range || !editor.s?.isCollapsed?.()) return;
    const insideCallout = findCallout(range.startContainer, editor.editor);
    const insideCode = findCodeBlock(range.startContainer, editor.editor);
    if (insideCallout || insideCode) return;
    const textNode = range.startContainer.nodeType === Node.TEXT_NODE ? (range.startContainer as Text) : null;
    if (!textNode) return;
    const nodeText = (textNode.textContent || "").replace(/\uFEFF/g, "").replace(/\u00a0/g, " ").trim();
    const atEnd = range.startOffset === (textNode.textContent?.length || 0);
    if (atEnd && /^-{3,}$/.test(nodeText)) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.textContent?.length || 0);
      range.deleteContents();
      const hr = editor.createInside.element("hr");
      editor.s.insertNode(hr);
      editor.s.setCursorAfter(hr);
      editor.s.synchronizeValues();
      event.preventDefault();
      event.stopPropagation();
    }
  });

  return {
    update: (content: string) => {
      const next = content || "";
      if (next === editor.value) return;
      isUpdating = true;
      editor.events.off("change", handleChange);
      editor.value = next;
      editor.history?.clear();
      lastEmittedValue = editor.value;
      editor.events.on("change", handleChange);
      isUpdating = false;
      applyHighlightToEditor(editor);
    },
    destroy: () => {
      editor.events.off("change", handleChange);
      editor.events.off("focus", handleFocus);
      editor.events.off("blur", handleBlur);
      const unlisten = (editor as any).__noteAttachmentUnlisten;
      if (typeof unlisten === "function") {
        unlisten();
      }
      editor.destruct();
      container.remove();
    },
  };
};

export const mountPreviewEditor = (root: HTMLElement): EditorInstance => {
  const container = document.createElement("div");
  container.className = "notes-editor notes-editor--preview";
  const editorWrapper = document.createElement("div");
  editorWrapper.className = "notes-editor__wrapper";
  const mountPoint = document.createElement("div");
  editorWrapper.appendChild(mountPoint);
  container.appendChild(editorWrapper);
  root.appendChild(container);

  const editor = new Jodit(
    mountPoint,
    createEditorConfig(
      {
        readonly: true,
        toolbar: false,
        statusbar: false,
        buttons: [],
        buttonsMD: [],
        buttonsSM: [],
        buttonsXS: [],
      },
      undefined
    )
  );
  editor.value = "";

  return {
    update: (content: string) => {
      const next = content || "";
      if (next === editor.value) return;
      editor.value = next;
    },
    destroy: () => {
      editor.destruct();
      container.remove();
    },
  };
};
