import { Jodit } from "jodit";
import "jodit/esm/plugins/all.js";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import php from "highlight.js/lib/languages/php";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("php", php);

const DEBUG_CODE = false;

export type EditorInstance = {
  update: (content: string) => void;
  destroy: () => void;
};

type EditorOptions = {
  content: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
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

const fragmentHasContent = (fragment: DocumentFragment) => {
  if (fragment.textContent && fragment.textContent.trim().length > 0) return true;
  return !!fragment.querySelector("img,table,ul,ol,li,hr,pre,blockquote");
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
  return !callout.querySelector("img,table,ul,ol,li,hr,pre,blockquote");
};

const isBlockEmpty = (block: HTMLElement) => {
  if (block.textContent && block.textContent.trim().length > 0) return false;
  return !block.querySelector("img,table,ul,ol,li,hr,pre,blockquote,code");
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
      } catch (e) {}
      return;
    }
    try {
      const result = hljs.highlightAuto(text, ["php", "html", "javascript", "css"]);
      code.innerHTML = result.value;
      code.className = result.language ? `hljs language-${result.language}` : "hljs";
    } catch (e) {}
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
        } catch (e) {}
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {}
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
        await open(href);
      } catch (e) {}
    },
    true
  );
};

const createEditorConfig = () => {
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
      "|",
      "ul",
      "ol",
      "callout",
      "todo",
      "codeblock",
      "|",
      "link",
      "image",
      "|",
      "undo",
      "redo",
    ],
    buttonsMD: [
      "bold",
      "italic",
      "underline",
      "|",
      "ul",
      "ol",
      "callout",
      "todo",
      "codeblock",
      "|",
      "link",
      "image",
      "|",
      "undo",
      "redo",
    ],
    buttonsSM: [
      "bold",
      "italic",
      "|",
      "ul",
      "ol",
      "callout",
      "todo",
      "codeblock",
      "|",
      "link",
      "|",
      "undo",
      "redo",
    ],
    buttonsXS: [
      "bold",
      "italic",
      "|",
      "ul",
      "ol",
      "callout",
      "todo",
      "codeblock",
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
        text: "C",
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
        text: "☐",
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
        text: "</>",
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
  };
};

export const mountEditor = (root: HTMLElement, options: EditorOptions): EditorInstance => {
  const container = document.createElement("div");
  container.className = "notes-editor flex flex-col h-full bg-white";
  const editorWrapper = document.createElement("div");
  editorWrapper.className = "flex-1 overflow-auto";
  const mountPoint = document.createElement("div");
  editorWrapper.appendChild(mountPoint);
  container.appendChild(editorWrapper);
  root.appendChild(container);

  const editor = new Jodit(mountPoint, createEditorConfig());
  editor.value = options.content || "";

  let isUpdating = false;
  const handleChange = () => {
    if (isUpdating) return;
    options.onChange(editor.value);
  };

  setupCodeToolbarHandlers(editor);
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
      if (content === editor.value) return;
      isUpdating = true;
      editor.value = content || "";
      editor.history?.clear();
      isUpdating = false;
      applyHighlightToEditor(editor);
    },
    destroy: () => {
      editor.events.off("change", handleChange);
      editor.events.off("focus", handleFocus);
      editor.events.off("blur", handleBlur);
      editor.destruct();
      container.remove();
    },
  };
};
