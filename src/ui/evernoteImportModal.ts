import { invoke } from "@tauri-apps/api/core";
import { openConfirmDialog } from "./dialogs";
import { runEvernoteImport, scanEvernoteSource } from "../services/evernoteImport";
import { logError } from "../services/logger";

type EvernoteImportModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

export const mountEvernoteImportModal = (root: HTMLElement): EvernoteImportModal => {
  let isOpen = false;
  let summary: Awaited<ReturnType<typeof scanEvernoteSource>> | null = null;
  let reportPath = "";

  const overlay = document.createElement("div");
  overlay.className = "import-modal";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="import-modal__panel">
      <div class="import-modal__header">
        <h3 class="import-modal__title">Import from Evernote</h3>
        <button class="import-modal__close" type="button" aria-label="Close">
          <svg class="import-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="import-modal__body">
        <div class="import-modal__hint">
          Select the folder that contains RemoteGraph.sql, internal_rteDoc, and resource-cache.
        </div>
        <div class="import-modal__path" data-import-path>Not selected</div>
        <div class="import-modal__status" data-import-status>
          <span class="import-modal__spinner" data-import-spinner></span>
          <span class="import-modal__status-text" data-import-status-text></span>
        </div>
        <div class="import-modal__summary is-hidden" data-import-summary></div>
        <div class="import-modal__report is-hidden" data-import-report></div>
      </div>
      <div class="import-modal__footer">
        <button class="import-modal__action" data-import-select type="button">Choose folder...</button>
        <button class="import-modal__action import-modal__action--primary" data-import-run type="button" disabled>Import</button>
        <button class="import-modal__action import-modal__action--ghost" data-import-cancel type="button">Close</button>
      </div>
    </div>
  `;

  root.appendChild(overlay);

  const closeBtn = overlay.querySelector<HTMLButtonElement>(".import-modal__close");
  const selectBtn = overlay.querySelector<HTMLButtonElement>("[data-import-select]");
  const runBtn = overlay.querySelector<HTMLButtonElement>("[data-import-run]");
  const cancelBtn = overlay.querySelector<HTMLButtonElement>("[data-import-cancel]");
  const pathEl = overlay.querySelector<HTMLElement>("[data-import-path]");
  const statusEl = overlay.querySelector<HTMLElement>("[data-import-status]");
  const statusTextEl = overlay.querySelector<HTMLElement>("[data-import-status-text]");
  const spinnerEl = overlay.querySelector<HTMLElement>("[data-import-spinner]");
  const summaryEl = overlay.querySelector<HTMLElement>("[data-import-summary]");
  const reportEl = overlay.querySelector<HTMLElement>("[data-import-report]");

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

  const setSummary = (nextSummary: typeof summary) => {
    summary = nextSummary;
    if (!summaryEl || !summary) return;
    summaryEl.classList.remove("is-hidden");
    const bytes = (value: number) => {
      if (!value) return "0 B";
      const sizes = ["B", "KB", "MB", "GB"];
      let index = 0;
      let size = value;
      while (size >= 1024 && index < sizes.length - 1) {
        size /= 1024;
        index += 1;
      }
      return `${size.toFixed(index === 0 ? 0 : 1)} ${sizes[index]}`;
    };
    summaryEl.innerHTML = `
      <div class="import-summary__row"><span>Notes</span><span>${summary.noteCount}</span></div>
      <div class="import-summary__row"><span>Notebooks</span><span>${summary.notebookCount}</span></div>
      <div class="import-summary__row"><span>Stacks</span><span>${summary.stackCount}</span></div>
      <div class="import-summary__row"><span>Tags</span><span>${summary.tagCount}</span></div>
      <div class="import-summary__row"><span>Note tags</span><span>${summary.noteTagCount}</span></div>
      <div class="import-summary__row"><span>Attachments</span><span>${summary.attachmentCount}</span></div>
      <div class="import-summary__row"><span>Attachment size</span><span>${bytes(summary.attachmentBytes)}</span></div>
      <div class="import-summary__row"><span>Images</span><span>${summary.imageCount}</span></div>
      <div class="import-summary__row"><span>Resources size</span><span>${bytes(summary.resourceBytes)}</span></div>
      <div class="import-summary__row"><span>Missing RTE files</span><span>${summary.missingRteCount}</span></div>
    `;
  };

  const setReport = (message: string) => {
    if (!reportEl) return;
    reportEl.textContent = message;
    reportEl.classList.remove("is-hidden");
  };

  const reset = () => {
    if (pathEl) pathEl.textContent = "Not selected";
    setStatus("", "muted");
    summaryEl?.classList.add("is-hidden");
    reportEl?.classList.add("is-hidden");
    if (runBtn) runBtn.disabled = true;
    summary = null;
    reportPath = "";
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

  selectBtn?.addEventListener("click", async () => {
    try {
      const selected = await invoke<string | null>("select_evernote_folder");
      if (!selected || typeof selected !== "string") return;
      let resolved = selected;
      const normalized = selected.replace(/\\/g, "/");
      if (normalized.toLowerCase().endsWith("/remotegraph.sql")) {
        resolved = normalized.slice(0, -"/remotegraph.sql".length);
      }
      if (pathEl) pathEl.textContent = resolved;
      setStatus("Scanning Evernote data...", "muted", true);
      summaryEl?.classList.add("is-hidden");
      const nextSummary = await scanEvernoteSource(resolved);
      setSummary(nextSummary);
      if (!nextSummary.valid) {
        setStatus(nextSummary.errors.join(" "), "error");
        if (runBtn) runBtn.disabled = true;
        return;
      }
      setStatus("Ready to import.", "ok");
      if (runBtn) runBtn.disabled = false;
    } catch (err) {
      logError("[import] scan failed", err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message ? `Scan failed: ${message}` : "Unable to scan Evernote data.", "error");
      if (runBtn) runBtn.disabled = true;
    }
  });

  runBtn?.addEventListener("click", async () => {
    if (!summary) return;
    try {
      const dataDir = await invoke<string>("get_data_dir");
      const info = await invoke<{ hasData: boolean }>("get_storage_info", { path: dataDir });
      if (info?.hasData) {
        const confirmed = await openConfirmDialog({
          title: "Replace current data?",
          message: "This will overwrite your current notes. A backup will be created before import.",
          confirmLabel: "Replace current",
          cancelLabel: "Cancel",
          danger: true,
        });
        if (!confirmed) return;
      }
    } catch (err) {
      logError("[import] storage check failed", err);
    }
    runBtn.disabled = true;
    selectBtn?.setAttribute("disabled", "disabled");
    setStatus("Preparing import...", "muted", true);
    try {
      const report = await runEvernoteImport(summary, (message) => setStatus(message, "muted", true));
      reportPath = `${report.backupDir}/import_report.json`;
      const hasErrors = report.errors.length > 0;
      setStatus(hasErrors ? "Import finished with errors." : "Import finished.", hasErrors ? "error" : "ok");
      setReport(`Report saved to ${reportPath}`);
      setSummary(report.summary);
    } catch (err) {
      logError("[import] failed", err);
      setStatus("Import failed. See report for details.", "error");
    } finally {
      selectBtn?.removeAttribute("disabled");
    }
  });

  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (!isOpen) return;
    if (event.key === "Escape") closeModal();
  });

  return {
    open: openModal,
    close: closeModal,
    destroy: () => overlay.remove(),
  };
};
