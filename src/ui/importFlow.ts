import { invoke } from "@tauri-apps/api/core";
import { openConfirmDialog } from "./dialogs";
import { t } from "../services/i18n";

type ReplacePrompt = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
};

type ImportReport = {
  errors: string[];
  failed?: boolean;
  backupDir: string;
};

type ImportResultHandlerOptions = {
  report: ImportReport;
  reportPath: string;
  setStatus: (message: string, tone?: "ok" | "error" | "muted", loading?: boolean) => void;
  setReport: (message: string) => void;
  texts: {
    finished: string;
    finishedErrors: string;
    failed: string;
    reportSavedKey: string;
    rollbackTitle: string;
    rollbackMessageKey: string;
    rollbackConfirm: string;
    rollbackContinue: string;
    rollbackFailedKey: string;
    restartMessage: string;
  };
};

let importInProgress = false;

export const beginImport = () => {
  if (importInProgress) return false;
  importInProgress = true;
  return true;
};

export const endImport = () => {
  importInProgress = false;
};

export const confirmReplaceIfNeeded = async (prompt: ReplacePrompt) => {
  const dataDir = await invoke<string>("get_data_dir");
  const info = await invoke<{ hasData: boolean }>("get_storage_info", { path: dataDir });
  if (!info?.hasData) {
    return true;
  }
  return openConfirmDialog({
    title: prompt.title,
    message: prompt.message,
    confirmLabel: prompt.confirmLabel,
    cancelLabel: prompt.cancelLabel,
    danger: true,
  });
};

export const handleImportResult = async (options: ImportResultHandlerOptions) => {
  const { report, reportPath, setStatus, setReport, texts } = options;
  const hasErrors = report.errors.length > 0;
  const isFailed = report.failed === true;
  setStatus(isFailed ? texts.failed : hasErrors ? texts.finishedErrors : texts.finished, isFailed || hasErrors ? "error" : "ok");
  setReport(t(texts.reportSavedKey, { path: reportPath }));
  if (hasErrors || isFailed) {
    const escapeHtml = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const errorItems = report.errors
      .map((err) => `<div class="import-error-list__item">${escapeHtml(err)}</div>`)
      .join("");
    const message = `
      <div class="import-error-summary">${escapeHtml(t(texts.rollbackMessageKey, { count: report.errors.length }))}</div>
      <div class="import-error-list">${errorItems}</div>
    `;
    const rollback = await openConfirmDialog({
      title: texts.rollbackTitle,
      message,
      confirmLabel: texts.rollbackConfirm,
      cancelLabel: texts.rollbackContinue,
      danger: true,
    });
    if (rollback) {
      try {
        await invoke("restore_import_backup", { backupDir: report.backupDir });
      } catch (e) {
        setStatus(t(texts.rollbackFailedKey, { message: String(e) }), "error");
      }
    }
  }
  openRestartDialog(texts.restartMessage);
};

export const openRestartDialog = (message: string) => {
  const dialog = document.createElement("div");
  dialog.className = "dialog-overlay";
  dialog.dataset.dialogOverlay = "1";
  dialog.innerHTML = `
    <div class="dialog storage-dialog">
      <div class="dialog__header">
        <h3 class="dialog__title">${t("storage.restart_title")}</h3>
      </div>
      <div class="dialog__body">
        <p>${message}</p>
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
