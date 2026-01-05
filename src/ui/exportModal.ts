import { invoke } from "@tauri-apps/api/core";
import { t } from "../services/i18n";
import { logError } from "../services/logger";

type ExportModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

type ExportReport = {
  export_root: string;
  manifest_path: string;
  notes: number;
  notebooks: number;
  tags: number;
  attachments: number;
  images: number;
  errors: string[];
};

export const mountExportModal = (root: HTMLElement): ExportModal => {
  let isOpen = false;
  let selectedPath = "";

  const overlay = document.createElement("div");
  overlay.className = "import-modal";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="import-modal__panel">
      <div class="import-modal__header">
        <h3 class="import-modal__title">${t("export.title")}</h3>
        <button class="import-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="import-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="import-modal__body">
        <div class="import-modal__hint">${t("export.hint")}</div>
        <div class="import-modal__path" data-export-path>${t("export.path_empty")}</div>
        <div class="import-modal__status" data-export-status>
          <span class="import-modal__spinner" data-export-spinner></span>
          <span class="import-modal__status-text" data-export-status-text></span>
        </div>
        <div class="import-modal__summary is-hidden" data-export-summary></div>
        <div class="import-modal__report is-hidden" data-export-report></div>
      </div>
      <div class="import-modal__footer">
        <button class="import-modal__action" data-export-select type="button">${t("export.select_folder")}</button>
        <button class="import-modal__action import-modal__action--primary" data-export-run type="button" disabled>${t("export.export")}</button>
        <button class="import-modal__action import-modal__action--ghost" data-export-cancel type="button">${t("settings.close")}</button>
      </div>
    </div>
  `;

  root.appendChild(overlay);

  const closeBtn = overlay.querySelector<HTMLButtonElement>(".import-modal__close");
  const selectBtn = overlay.querySelector<HTMLButtonElement>("[data-export-select]");
  const runBtn = overlay.querySelector<HTMLButtonElement>("[data-export-run]");
  const cancelBtn = overlay.querySelector<HTMLButtonElement>("[data-export-cancel]");
  const pathEl = overlay.querySelector<HTMLElement>("[data-export-path]");
  const statusEl = overlay.querySelector<HTMLElement>("[data-export-status]");
  const statusTextEl = overlay.querySelector<HTMLElement>("[data-export-status-text]");
  const spinnerEl = overlay.querySelector<HTMLElement>("[data-export-spinner]");
  const summaryEl = overlay.querySelector<HTMLElement>("[data-export-summary]");
  const reportEl = overlay.querySelector<HTMLElement>("[data-export-report]");

  const setStatus = (message: string, tone: "ok" | "error" | "muted" = "muted", loading = false) => {
    if (!statusEl) return;
    if (statusTextEl) {
      statusTextEl.textContent = message;
    } else {
      statusEl.textContent = message;
    }
    statusEl.className = `import-modal__status is-${tone} ${loading ? "is-loading" : ""}`;
    if (spinnerEl) {
      spinnerEl.style.display = loading ? "inline-flex" : "none";
    }
  };

  const setSummary = (report: ExportReport) => {
    if (!summaryEl) return;
    summaryEl.classList.remove("is-hidden");
    summaryEl.innerHTML = `
      <div class="import-summary__row"><span>${t("export.summary.notes")}</span><span>${report.notes}</span></div>
      <div class="import-summary__row"><span>${t("export.summary.notebooks")}</span><span>${report.notebooks}</span></div>
      <div class="import-summary__row"><span>${t("export.summary.tags")}</span><span>${report.tags}</span></div>
      <div class="import-summary__row"><span>${t("export.summary.images")}</span><span>${report.images}</span></div>
      <div class="import-summary__row"><span>${t("export.summary.attachments")}</span><span>${report.attachments}</span></div>
    `;
  };

  const setReport = (message: string) => {
    if (!reportEl) return;
    reportEl.textContent = message;
    reportEl.classList.remove("is-hidden");
  };

  const reset = () => {
    selectedPath = "";
    if (pathEl) pathEl.textContent = t("export.path_empty");
    setStatus("", "muted");
    summaryEl?.classList.add("is-hidden");
    reportEl?.classList.add("is-hidden");
    if (runBtn) runBtn.disabled = true;
  };

  const openModal = () => {
    if (isOpen) return;
    isOpen = true;
    overlay.style.display = "flex";
    reset();
  };

  const closeModal = () => {
    if (!isOpen) return;
    isOpen = false;
    overlay.style.display = "none";
  };

  const handleSelect = async () => {
    setStatus("", "muted");
    setReport("");
    const selected = await invoke<string | null>("select_export_folder");
    if (!selected || !pathEl) return;
    selectedPath = selected;
    pathEl.textContent = selected;
    if (runBtn) runBtn.disabled = false;
    setStatus(t("export.ready"), "ok");
  };

  const handleRun = async () => {
    if (!selectedPath) return;
    setStatus(t("export.running"), "muted", true);
    setReport("");
    try {
      const report = await invoke<ExportReport>("export_notes_classic", { destDir: selectedPath });
      setStatus(t("export.finished"), "ok");
      setSummary(report);
      setReport(t("export.report_saved", { path: report.manifest_path }));
      closeModal();
      showExportDialog(report);
    } catch (err) {
      logError("[export] failed", err);
      setStatus(t("export.failed"), "error");
      setReport(String(err));
      if (statusEl && reportEl && statusEl.nextSibling !== reportEl) {
        statusEl.insertAdjacentElement("afterend", reportEl);
      }
    }
  };

  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  selectBtn?.addEventListener("click", handleSelect);
  runBtn?.addEventListener("click", handleRun);

  const showExportDialog = (report: ExportReport) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";
    overlay.innerHTML = `
      <div class="dialog export-dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${t("export.done_title")}</h3>
          <button class="dialog__close" type="button" data-export-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body dialog__body--message">
          <div class="import-summary">
            <div class="import-summary__row"><span>${t("export.summary.notes")}</span><span>${report.notes}</span></div>
            <div class="import-summary__row"><span>${t("export.summary.notebooks")}</span><span>${report.notebooks}</span></div>
            <div class="import-summary__row"><span>${t("export.summary.tags")}</span><span>${report.tags}</span></div>
            <div class="import-summary__row"><span>${t("export.summary.images")}</span><span>${report.images}</span></div>
            <div class="import-summary__row"><span>${t("export.summary.attachments")}</span><span>${report.attachments}</span></div>
          </div>
          <div class="export-dialog__path">${t("export.report_saved", { path: report.manifest_path })}</div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--primary" data-export-close="1">${t("settings.close")}</button>
        </div>
      </div>
    `;
    const cleanup = () => overlay.remove();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup();
    });
    overlay.querySelectorAll("[data-export-close]").forEach((btn) => {
      btn.addEventListener("click", cleanup);
    });
    document.body.appendChild(overlay);
  };

  return {
    open: openModal,
    close: closeModal,
    destroy: () => {
      overlay.remove();
    },
  };
};
