import { Jodit } from "jodit";

export type EditorInstance = {
  update: (content: string) => void;
  destroy: () => void;
};

type EditorOptions = {
  content: string;
  onChange: (value: string) => void;
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
      "|",
      "undo",
      "redo",
    ],
    cleanHTML: {
      fillEmptyParagraph: false,
      removeEmptyElements: false,
    },
    style: {
      minHeight: "500px",
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

  editor.events.on("change", handleChange);

  return {
    update: (content: string) => {
      if (content === editor.value) return;
      isUpdating = true;
      editor.value = content || "";
      editor.history?.clear();
      isUpdating = false;
    },
    destroy: () => {
      editor.events.off("change", handleChange);
      editor.destruct();
      container.remove();
    },
  };
};
