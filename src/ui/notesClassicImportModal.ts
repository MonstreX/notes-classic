import { invoke } from "@tauri-apps/api/core";
import { openConfirmDialog } from "./dialogs";
import { runNotesClassicImport, scanNotesClassicSource } from "../services/notesClassicImport";
import { logError } from "../services/logger";
import { t } from "../services/i18n";

type NotesClassicImportModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

export const mountNotesClassicImportModal = (
  root: HTMLElement,
  handlers?: { onImportStart?: () => void; onImportEnd?: () => void }
): NotesClassicImportModal => {
  let isOpen = false;
  let summary: Awaited<ReturnType<typeof scanNotesClassicSource>> | null = null;
  let reportPath = "";

  const overlay = document.createElement("div");
  overlay.className = "import-modal";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="import-modal__panel">
      <div class="import-modal__header">
        <h3 class="import-modal__title">${t("import_notes_classic.title")}</h3>
        <button class="import-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="import-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="import-modal__body">
        <div class="import-modal__hint">
          ${t("import_notes_classic.hint")}
        </div>
        <div class="import-modal__path" data-import-path>${t("import_notes_classic.path_empty")}</div>
        <div class="import-modal__status" data-import-status>
          <span class="import-modal__spinner" data-import-spinner></span>
          <span class="import-modal__status-text" data-import-status-text></span>
        </div>
        <div class="import-modal__summary is-hidden" data-import-summary></div>
        <div class="import-modal__stages is-hidden" data-import-stages></div>
        <div class="import-modal__report is-hidden" data-import-report></div>
      </div>
      <div class="import-modal__footer">
        <button class="import-modal__action" data-import-select type="button">${t("import_notes_classic.select_folder")}</button>
        <button class="import-modal__action import-modal__action--primary" data-import-run type="button" disabled>${t("import_notes_classic.import")}</button>
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
    summaryEl.innerHTML = `
      <div class="import-summary__row"><span>${t("import_notes_classic.summary.notes")}</span><span>${summary.noteCount}</span></div>
      <div class="import-summary__row"><span>${t("import_notes_classic.summary.notebooks")}</span><span>${summary.notebookCount}</span></div>
      <div class="import-summary__row"><span>${t("import_notes_classic.summary.tags")}</span><span>${summary.tagCount}</span></div>
      <div class="import-summary__row"><span>${t("import_notes_classic.summary.attachments")}</span><span>${summary.attachmentCount}</span></div>
      <div class="import-summary__row"><span>${t("import_notes_classic.summary.images")}</span><span>${summary.imageCount}</span></div>
    `;
  };

  const setReport = (message: string) => {
    if (!reportEl) return;
    reportEl.textContent = message;
    reportEl.classList.remove("is-hidden");
  };

  const stageOrder = [
    { id: "notes", title: t("import_notes_classic.progress.notes") },
    { id: "attachments", title: t("import_notes_classic.progress.attachments") },
    { id: "database", title: t("import_notes_classic.progress.database") },
  ] as const;

  type StageElements = {
    root: HTMLElement;
    fill: HTMLElement;
    count: HTMLElement;
  };

  const stageElements: Record<string, StageElements> = {};
  const stageTitles = stageOrder.reduce<Record<string, string>>((acc, stage) => {
    acc[stage.id] = stage.title;
    return acc;
  }, {});

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
    state: "running" | "done" | "error" = "running",
    message?: string
  ) => {
    const stage = stageElements[id];
    if (!stage) return;
    if (state === "running") {
      setStatus(message ?? stageTitles[id] ?? "", "muted", true);
    }
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
          <p>${t("import_notes_classic.restart")}</p>
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
    if (pathEl) pathEl.textContent = t("import_notes_classic.path_empty");
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

  const handleSelect = async () => {
    setStatus("", "muted");
    setReport("");
    const selected = await invoke<string | null>("select_notes_classic_folder");
    if (!selected || !pathEl) return;
    pathEl.textContent = selected;
    setStatus(t("import_notes_classic.scanning"), "muted", true);
    try {
      summary = await scanNotesClassicSource(selected);
      if (!summary.valid) {
        setStatus(t("import_notes_classic.scan_failed_generic"), "error");
        return;
      }
      setSummary(summary);
      setStatus(t("import_notes_classic.ready"), "ok");
      if (runBtn) runBtn.disabled = false;
    } catch (e) {
      logError("[import] notes-classic scan failed", e);
      setStatus(t("import_notes_classic.scan_failed", { message: String(e) }), "error");
    }
  };

  const handleRun = async () => {
    if (!summary || !pathEl) return;
    if (runBtn) runBtn.disabled = true;
    if (selectBtn) selectBtn.disabled = true;
    try {
      const dataDir = await invoke<string>("get_data_dir");
      const info = await invoke<{ hasData: boolean }>("get_storage_info", { path: dataDir });
      if (info?.hasData) {
        const shouldReplace = await openConfirmDialog({
          title: t("import_notes_classic.replace_title"),
          message: t("import_notes_classic.replace_message"),
          confirmLabel: t("import_notes_classic.replace_confirm"),
        });
        if (!shouldReplace) {
          setStatus(t("import_notes_classic.ready"), "ok");
          if (runBtn) runBtn.disabled = false;
          if (selectBtn) selectBtn.disabled = false;
          return;
        }
      }
      setStatus(t("import_notes_classic.preparing_manifest"), "muted", true);
      initStages({
        notes: summary.noteCount,
        attachments: summary.attachmentCount + summary.imageCount,
        database: 4,
      });
      if (handlers?.onImportStart) {
        await handlers.onImportStart();
      }
      const report = await runNotesClassicImport(
        summary.sourceRoot,
        (progress) => {
          const message = progress.message ? t(progress.message) : undefined;
          setStageProgress(progress.stage, progress.current, progress.total, progress.state ?? "running", message);
        },
        (message) => {
          if (message) {
            setStatus(message, "muted", true);
          }
        },
        summary
      );
      reportPath = `${report.backupDir}/import_report.json`;
      const hasErrors = report.errors.length > 0;
      const isFailed = report.failed === true;
      setStatus(
        isFailed ? t("import_notes_classic.failed") : hasErrors ? t("import_notes_classic.finished_errors") : t("import_notes_classic.finished"),
        isFailed || hasErrors ? "error" : "ok"
      );
      setReport(t("import_notes_classic.report_saved", { path: reportPath }));
      if (hasErrors || isFailed) {
        const rollback = await openConfirmDialog({
          title: t("import.rollback_title"),
          message: t("import.rollback_message", { count: report.errors.length }),
          confirmLabel: t("import.rollback_confirm"),
          cancelLabel: t("import.rollback_continue"),
          danger: true,
        });
        if (rollback) {
          try {
            await invoke("restore_import_backup", { backupDir: report.backupDir });
          } catch (e) {
            setStatus(t("import.rollback_failed", { message: String(e) }), "error");
          }
        }
      }
      openRestartDialog();
    } catch (err) {
      logError("[import] notes-classic failed", err);
      setStatus(t("import_notes_classic.failed"), "error");
      setReport(String(err));
      if (statusEl && reportEl && statusEl.nextSibling !== reportEl) {
        statusEl.insertAdjacentElement("afterend", reportEl);
      }
    } finally {
      handlers?.onImportEnd?.();
      if (runBtn) runBtn.disabled = false;
      if (selectBtn) selectBtn.disabled = false;
    }
  };

  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  selectBtn?.addEventListener("click", handleSelect);
  runBtn?.addEventListener("click", handleRun);

  return {
    open: openModal,
    close: closeModal,
    destroy: () => {
      overlay.remove();
    },
  };
};
