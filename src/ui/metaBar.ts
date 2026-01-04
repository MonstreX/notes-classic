import type { NoteDetail } from "../state/types";
import { createIcon } from "./icons";
import { t } from "../services/i18n";

export type MetaBarState = {
  hasNote: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  activeNote: NoteDetail | null;
};

export const mountMetaBar = (
  container: HTMLElement,
  handlers: { onBack: () => void; onForward: () => void }
) => {
  const metaBar = document.createElement("div");
  metaBar.className = "app-shell__meta";
  const nav = document.createElement("div");
  nav.className = "app-shell__nav";
  const backButton = document.createElement("button");
  backButton.className = "app-shell__nav-btn";
  backButton.type = "button";
  backButton.title = t("history.back");
  const backIcon = createIcon("icon-chevron", "app-shell__nav-icon app-shell__nav-icon--back");
  backButton.appendChild(backIcon);
  const forwardButton = document.createElement("button");
  forwardButton.className = "app-shell__nav-btn";
  forwardButton.type = "button";
  forwardButton.title = t("history.forward");
  const forwardIcon = createIcon("icon-chevron", "app-shell__nav-icon app-shell__nav-icon--forward");
  forwardButton.appendChild(forwardIcon);
  nav.appendChild(backButton);
  nav.appendChild(forwardButton);
  const metaUpdated = document.createElement("span");
  metaUpdated.className = "app-shell__meta-updated";
  metaBar.appendChild(nav);
  metaBar.appendChild(metaUpdated);
  if (container.firstChild) {
    container.insertBefore(metaBar, container.firstChild);
  } else {
    container.appendChild(metaBar);
  }

  backButton.addEventListener("click", handlers.onBack);
  forwardButton.addEventListener("click", handlers.onForward);

  const update = (state: MetaBarState) => {
    backButton.disabled = !state.canGoBack;
    forwardButton.disabled = !state.canGoForward;
    if (state.activeNote?.updatedAt) {
      const date = new Date(state.activeNote.updatedAt * 1000);
      const formatted = date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      metaUpdated.textContent = t("meta.last_edited", { date: formatted });
    } else {
      metaUpdated.textContent = "";
    }
  };

  return {
    element: metaBar,
    update,
    destroy: () => metaBar.remove(),
  };
};
