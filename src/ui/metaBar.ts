import type { Notebook, NoteDetail } from "../state/types";
import { createIcon } from "./icons";

export type MetaBarState = {
  hasNote: boolean;
  notebooks: Notebook[];
  selectedNotebookId: number | null;
  activeNote: NoteDetail | null;
};

export const mountMetaBar = (container: HTMLElement) => {
  const metaBar = document.createElement("div");
  metaBar.className = "app-shell__meta";
  const metaStackIcon = createIcon("icon-stack", "app-shell__meta-icon");
  const metaStackText = document.createElement("span");
  metaStackText.className = "app-shell__meta-text";
  const metaSep = document.createElement("span");
  metaSep.className = "app-shell__meta-sep";
  metaSep.textContent = "|";
  const metaNotebookIcon = createIcon("icon-notebook", "app-shell__meta-icon");
  const metaNotebookText = document.createElement("span");
  metaNotebookText.className = "app-shell__meta-text";
  const metaUpdated = document.createElement("span");
  metaUpdated.className = "app-shell__meta-updated";
  metaBar.appendChild(metaStackIcon);
  metaBar.appendChild(metaStackText);
  metaBar.appendChild(metaSep);
  metaBar.appendChild(metaNotebookIcon);
  metaBar.appendChild(metaNotebookText);
  metaBar.appendChild(metaUpdated);
  container.appendChild(metaBar);

  const update = (state: MetaBarState) => {
    if (!state.hasNote || state.selectedNotebookId === null) {
      metaSep.classList.add("is-hidden");
      metaStackIcon.classList.add("is-hidden");
      metaStackText.classList.add("is-hidden");
      metaNotebookIcon.classList.add("is-hidden");
      metaNotebookText.classList.add("is-hidden");
      metaStackText.textContent = "";
      metaNotebookText.textContent = "";
      metaUpdated.textContent = "";
      return;
    }
    const notebook = state.notebooks.find((nb) => nb.id === state.selectedNotebookId) || null;
    const stack = notebook?.parentId
      ? state.notebooks.find((nb) => nb.id === notebook.parentId)
      : null;
    metaStackText.textContent = stack?.name ?? "";
    metaNotebookText.textContent = notebook?.name ?? "";
    if (state.activeNote?.updatedAt) {
      const date = new Date(state.activeNote.updatedAt * 1000);
      const formatted = date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      metaUpdated.textContent = `Last edited on ${formatted}`;
    } else {
      metaUpdated.textContent = "";
    }
    metaSep.classList.toggle("is-hidden", !stack);
    metaStackIcon.classList.toggle("is-hidden", !stack);
    metaStackText.classList.toggle("is-hidden", !stack);
    metaNotebookIcon.classList.toggle("is-hidden", !notebook);
    metaNotebookText.classList.toggle("is-hidden", !notebook);
  };

  return {
    element: metaBar,
    update,
    destroy: () => metaBar.remove(),
  };
};
