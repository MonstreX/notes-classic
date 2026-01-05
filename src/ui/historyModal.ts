import { t } from "../services/i18n";
import { getNoteHistory, type NoteHistoryItem } from "../services/history";

type HistoryModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

export const mountHistoryModal = (
  root: HTMLElement,
  handlers: { onOpenNote: (noteId: number) => void }
): HistoryModal => {
  let isOpen = false;
  const overlay = document.createElement("div");
  overlay.className = "history-modal";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="history-modal__panel">
      <div class="history-modal__header">
        <h3 class="history-modal__title">${t("history.title")}</h3>
        <button class="history-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="history-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="history-modal__body">
        <div class="history-modal__list" data-history-list="1"></div>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  const listEl = overlay.querySelector<HTMLElement>("[data-history-list]");
  const closeBtn = overlay.querySelector<HTMLButtonElement>(".history-modal__close");

  const formatGroupTitle = (timestamp: number) => {
    try {
      return new Date(timestamp * 1000).toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      });
    } catch {
      return t("settings.unknown");
    }
  };

  const formatTimestamp = (timestamp: number) => {
    try {
      return new Date(timestamp * 1000).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return t("settings.unknown");
    }
  };

  const renderHistory = (items: NoteHistoryItem[]) => {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = `<div class="history-modal__empty">${t("history.empty")}</div>`;
      return;
    }
    const groups = new Map<string, NoteHistoryItem[]>();
    items.forEach((item) => {
      const key = formatGroupTitle(item.openedAt);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    });
    const html = Array.from(groups.entries())
      .map(([group, groupItems]) => {
        const rows = groupItems
          .map((item) => {
            const title = item.noteTitle || t("notes.untitled");
            const notebookLabel = item.notebookName || t("notes.notebook_default");
            const stackLabel = item.stackName ? `${item.stackName} - ${notebookLabel}` : notebookLabel;
            const when = formatTimestamp(item.openedAt);
            return `
              <div class="history-item" data-history-item="1" data-note-id="${item.noteId}">
                <div class="history-item__main">
                  <div class="history-item__title">${title}</div>
                  <div class="history-item__meta">${stackLabel}</div>
                </div>
                <div class="history-item__right">
                  <div class="history-item__time">${when}</div>
                </div>
              </div>
            `;
          })
          .join("");
        return `
          <div class="history-group">
            <div class="history-group__title">${group}</div>
            <div class="history-group__list">${rows}</div>
          </div>
        `;
      })
      .join("");
    listEl.innerHTML = html;
  };

  const openModal = async () => {
    if (isOpen) return;
    isOpen = true;
    overlay.style.display = "flex";
    const items = await getNoteHistory(1000, 0);
    renderHistory(items);
  };

  const closeModal = () => {
    if (!isOpen) return;
    isOpen = false;
    overlay.style.display = "none";
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  closeBtn?.addEventListener("click", closeModal);
  overlay.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") closeModal();
  });
  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>("[data-history-item]");
    if (!row) return;
    const noteId = Number(row.getAttribute("data-note-id"));
    if (!Number.isFinite(noteId)) return;
    handlers.onOpenNote(noteId);
    closeModal();
  });
  overlay.addEventListener("dblclick", (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>("[data-history-item]");
    if (!row) return;
    const noteId = Number(row.getAttribute("data-note-id"));
    if (!Number.isFinite(noteId)) return;
    handlers.onOpenNote(noteId);
    closeModal();
  });

  return {
    open: openModal,
    close: closeModal,
    destroy: () => overlay.remove(),
  };
};
