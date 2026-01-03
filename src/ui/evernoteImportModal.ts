import { invoke } from "@tauri-apps/api/core";
import { openConfirmDialog } from "./dialogs";
import { runEvernoteImport, scanEvernoteSource } from "../services/evernoteImport";
import { logError } from "../services/logger";
import { t } from "../services/i18n";

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
        <h3 class="import-modal__title">${t("import.title")}</h3>
        <button class="import-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="import-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="import-modal__body">
        <div class="import-modal__hint">
          ${t("import.hint")}
        </div>
        <div class="import-modal__path" data-import-path>${t("import.path_empty")}</div>
        <div class="import-modal__status" data-import-status>
          <span class="import-modal__spinner" data-import-spinner></span>
          <span class="import-modal__status-text" data-import-status-text></span>
        </div>
        <div class="import-modal__summary is-hidden" data-import-summary></div>
        <div class="import-modal__stages is-hidden" data-import-stages></div>
        <div class="import-modal__report is-hidden" data-import-report></div>
      </div>
      <div class="import-modal__footer">
        <button class="import-modal__action" data-import-select type="button">${t("import.select_folder")}</button>
        <button class="import-modal__action import-modal__action--primary" data-import-run type="button" disabled>${t("import.import")}</button>
        <button class="import-modal__action import-modal__action--ghost" data-import-cancel type="button">${t("settings.close")}</button>
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
  const stagesEl = overlay.querySelector<HTMLElement>("[data-import-stages]");
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
      <div class="import-summary__row"><span>${t("import.summary.notes")}</span><span>${summary.noteCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.notebooks")}</span><span>${summary.notebookCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.stacks")}</span><span>${summary.stackCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.tags")}</span><span>${summary.tagCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.note_tags")}</span><span>${summary.noteTagCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.attachments")}</span><span>${summary.attachmentCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.attachment_bytes")}</span><span>${bytes(summary.attachmentBytes)}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.images")}</span><span>${summary.imageCount}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.resources")}</span><span>${bytes(summary.resourceBytes)}</span></div>
      <div class="import-summary__row"><span>${t("import.summary.missing_rte")}</span><span>${summary.missingRteCount}</span></div>
    `;
  };

  const setReport = (message: string) => {
    if (!reportEl) return;
    reportEl.textContent = message;
    reportEl.classList.remove("is-hidden");
  };

  const stageOrder = [
    { id: "tables", title: t("import.progress.tables") },
    { id: "resources", title: t("import.progress.resources") },
    { id: "decode", title: t("import.progress.decode") },
    { id: "database", title: t("import.progress.database") },
  ] as const;

  const stageTitles = new Map(stageOrder.map((stage) => [stage.id, stage.title]));

  type StageElements = {
    root: HTMLElement;
    fill: HTMLElement;
    count: HTMLElement;
  };

  const stageElements: Record<string, StageElements> = {};

  const initStages = (totals?: Partial<Record<(typeof stageOrder)[number]["id"], number>>) => {
    if (!stagesEl) return;
    Object.keys(stageElements).forEach((key) => {
      delete stageElements[key];
    });
    stagesEl.innerHTML = "";
    stageOrder.forEach((stage) => {
      const total = totals?.[stage.id] ?? 0;
      const row = document.createElement("div");
      row.className = "import-stage";
      row.dataset.stageId = stage.id;
      row.innerHTML = `
        <div class="import-stage__header">
          <div class="import-stage__title">${stage.title}</div>
          <div class="import-stage__count">0/${total}</div>
        </div>
        <div class="import-stage__bar"><span class="import-stage__bar-fill"></span></div>
      `;
      const fill = row.querySelector<HTMLElement>(".import-stage__bar-fill");
      const count = row.querySelector<HTMLElement>(".import-stage__count");
      if (fill && count) {
        stageElements[stage.id] = { root: row, fill, count };
      }
      stagesEl.appendChild(row);
    });
    stagesEl.classList.remove("is-hidden");
  };

  const setStageProgress = (
    id: string,
    current = 0,
    total = 0,
    state: "running" | "done" | "error" = "running"
  ) => {
    const stage = stageElements[id];
    if (!stage) return;
    const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
    const safeCurrent = Number.isFinite(current) && current >= 0 ? current : 0;
    const percent =
      safeTotal > 0 ? Math.min(100, Math.round((safeCurrent / safeTotal) * 100)) : state === "done" ? 100 : 0;
    stage.count.textContent = `${safeCurrent}/${safeTotal}`;
    stage.fill.style.width = `${percent}%`;
    stage.root.classList.toggle("is-running", state === "running");
    stage.root.classList.toggle("is-done", state === "done");
    stage.root.classList.toggle("is-error", state === "error");
  };

  const openRestartDialog = () => {
    const dialog = document.createElement("div");
    dialog.className = "dialog-overlay";
    dialog.dataset.dialogOverlay = "1";
    dialog.innerHTML = `
      <div class="dialog storage-dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${t("storage.restart_title")}</h3>
        </div>
        <div class="dialog__body">
          <p>${t("import.restart")}</p>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button" data-restart-now="1">${t("storage.restart_now")}</button>
          <button class="dialog__button dialog__button--danger" data-exit-now="1">${t("storage.exit_now")}</button>
        </div>
      </div>
    `;
    dialog.querySelector("[data-restart-now]")?.addEventListener("click", () => {
      invoke("restart_app");
    });
    dialog.querySelector("[data-exit-now]")?.addEventListener("click", () => {
      invoke("exit_app");
    });
    document.body.appendChild(dialog);
  };

  const reset = () => {
    if (pathEl) pathEl.textContent = t("import.path_empty");
    setStatus("", "muted");
    summaryEl?.classList.add("is-hidden");
    stagesEl?.classList.add("is-hidden");
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
      setStatus(t("import.scanning"), "muted", true);
      summaryEl?.classList.add("is-hidden");
      const nextSummary = await scanEvernoteSource(resolved);
      setSummary(nextSummary);
      if (!nextSummary.valid) {
        setStatus(nextSummary.errors.join(" "), "error");
        if (runBtn) runBtn.disabled = true;
        return;
      }
      setStatus(t("import.ready"), "ok");
      if (runBtn) runBtn.disabled = false;
    } catch (err) {
      logError("[import] scan failed", err);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message ? t("import.scan_failed", { message }) : t("import.scan_failed_generic"), "error");
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
          title: t("import.replace_title"),
          message: t("import.replace_message"),
          confirmLabel: t("import.replace_confirm"),
          cancelLabel: t("dialog.cancel"),
          danger: true,
        });
        if (!confirmed) return;
      }
    } catch (err) {
      logError("[import] storage check failed", err);
    }
    runBtn.disabled = true;
    selectBtn?.setAttribute("disabled", "disabled");
    summaryEl?.classList.add("is-hidden");
    reportEl?.classList.add("is-hidden");
    initStages({
      tables: 1,
      resources: summary.attachmentCount,
      decode: summary.noteCount,
      database: 1,
    });
    setStatus(t("import.preparing"), "muted", true);
    try {
      const report = await runEvernoteImport(summary, (event) => {
        if (event.stage && event.state === "running") {
          const title = stageTitles.get(event.stage) ?? t("import.running");
          setStatus(`${title}...`, "muted", true);
        }
        if (event.stage) {
          setStageProgress(event.stage, event.current ?? 0, event.total ?? 0, event.state ?? "running");
        }
      });
      reportPath = `${report.backupDir}/import_report.json`;
      const hasErrors = report.errors.length > 0;
      setStatus(hasErrors ? t("import.finished_errors") : t("import.finished"), hasErrors ? "error" : "ok");
      setReport(t("import.report_saved", { path: reportPath }));
      openRestartDialog();
    } catch (err) {
      logError("[import] failed", err);
      setStatus(t("import.failed"), "error");
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
