import { invoke } from "@tauri-apps/api/core";
import { runHtmlImport, scanHtmlSource } from "../services/htmlImport";
import { logError } from "../services/logger";
import { t } from "../services/i18n";
import { beginImport, confirmReplaceIfNeeded, endImport, handleImportResult } from "./importFlow";

type HtmlImportModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
};

export const mountHtmlImportModal = (
  root: HTMLElement,
  handlers?: { onImportStart?: () => void; onImportEnd?: () => void }
): HtmlImportModal => {
  let isOpen = false;
  let summary: Awaited<ReturnType<typeof scanHtmlSource>> | null = null;
  let reportPath = "";

  const overlay = document.createElement("div");
  overlay.className = "import-modal";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="import-modal__panel">
      <div class="import-modal__header">
        <h3 class="import-modal__title">${t("import_html.title")}</h3>
        <button class="import-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="import-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="import-modal__body">
        <div class="import-modal__hint">
          ${t("import_html.hint")}
        </div>
        <div class="import-modal__path" data-import-path>${t("import_html.path_empty")}</div>
        <div class="import-modal__status" data-import-status>
          <span class="import-modal__spinner" data-import-spinner></span>
          <span class="import-modal__status-text" data-import-status-text></span>
        </div>
        <div class="import-modal__summary is-hidden" data-import-summary></div>
        <div class="import-modal__stages is-hidden" data-import-stages></div>
        <div class="import-modal__report is-hidden" data-import-report></div>
      </div>
      <div class="import-modal__footer">
        <button class="import-modal__action" data-import-select type="button">${t("import_html.select_folder")}</button>
        <button class="import-modal__action import-modal__action--primary" data-import-run type="button" disabled>${t("import_html.import")}</button>
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

  const setControlsDisabled = (disabled: boolean) => {
    if (runBtn) runBtn.disabled = disabled;
    if (selectBtn) selectBtn.disabled = disabled;
  };

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
      <div class="import-summary__row"><span>${t("import_html.summary.notes")}</span><span>${summary.noteCount}</span></div>
      <div class="import-summary__row"><span>${t("import_html.summary.notebooks")}</span><span>${summary.notebookCount}</span></div>
      <div class="import-summary__row"><span>${t("import_html.summary.stacks")}</span><span>${summary.stackCount}</span></div>
      <div class="import-summary__row"><span>${t("import_html.summary.attachments")}</span><span>${summary.attachmentCount}</span></div>
      <div class="import-summary__row"><span>${t("import_html.summary.images")}</span><span>${summary.imageCount}</span></div>
    `;
  };

  const setReport = (message: string) => {
    if (!reportEl) return;
    reportEl.textContent = message;
    reportEl.classList.remove("is-hidden");
  };

  const stageOrder = [
    { id: "notes", title: t("import_html.progress.notes") },
  ] as const;

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

  const reset = () => {
    if (pathEl) pathEl.textContent = t("import_html.path_empty");
    setStatus("", "muted");
    summaryEl?.classList.add("is-hidden");
    stagesEl?.classList.add("is-hidden");
    reportEl?.classList.add("is-hidden");
    if (runBtn) runBtn.disabled = true;
    if (selectBtn) selectBtn.disabled = false;
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
    const selected = await invoke<string | null>("select_html_folder");
    if (!selected || !pathEl) return;
    pathEl.textContent = selected;
    setStatus(t("import_html.scanning"), "muted", true);
    try {
      summary = await scanHtmlSource(selected);
      if (!summary.valid) {
        setStatus(t("import_html.scan_failed_generic"), "error");
        return;
      }
      setSummary(summary);
      setStatus(t("import_html.ready"), "ok");
      if (runBtn) runBtn.disabled = false;
    } catch (e) {
      logError("[import] html scan failed", e);
      setStatus(t("import_html.scan_failed", { message: String(e) }), "error");
    }
  };

  const handleRun = async () => {
    if (!summary || !pathEl) return;
    try {
      const shouldReplace = await confirmReplaceIfNeeded({
        title: t("import_html.replace_title"),
        message: t("import_html.replace_message"),
        confirmLabel: t("import_html.replace_confirm"),
      });
      if (!shouldReplace) return;
      if (!beginImport()) {
        return;
      }
      setControlsDisabled(true);
      if (handlers?.onImportStart) {
        await handlers.onImportStart();
      }
      setStatus(t("import_html.preparing"), "muted", true);
      initStages({
        notes: summary.noteCount,
      });
      const report = await runHtmlImport(summary.sourceRoot, (progress) => {
        setStageProgress(progress.stage, progress.current, progress.total, progress.state ?? "running");
      });
      reportPath = `${report.backupDir}/import_report.json`;
      await handleImportResult({
        report,
        reportPath,
        setStatus,
        setReport,
        texts: {
          finished: t("import_html.finished"),
          finishedErrors: t("import_html.finished_errors"),
          failed: t("import_html.failed"),
          reportSavedKey: "import_html.report_saved",
          rollbackTitle: t("import.rollback_title"),
          rollbackMessageKey: "import.rollback_message",
          rollbackConfirm: t("import.rollback_confirm"),
          rollbackContinue: t("import.rollback_continue"),
          rollbackFailedKey: "import.rollback_failed",
          restartMessage: t("import_html.restart"),
        },
      });
    } catch (err) {
      logError("[import] html failed", err);
      setStatus(t("import_html.failed"), "error");
      setReport(String(err));
      if (statusEl && reportEl && statusEl.nextSibling !== reportEl) {
        statusEl.insertAdjacentElement("afterend", reportEl);
      }
    } finally {
      handlers?.onImportEnd?.();
      endImport();
      setControlsDisabled(false);
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
