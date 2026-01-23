import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { appStore } from "../state/store";
import {
  getDefaultStoragePath,
  getDataDir,
  getStorageInfo,
  getStorageOverride,
  setStorageDefault,
  setStorageDefaultExisting,
  setStorageDefaultReplace,
  setStorageDefaultEmpty,
  setStoragePath,
  setStoragePathExisting,
  setStoragePathReplace,
  setStoragePathEmpty,
} from "../services/storage";
import { logError } from "../services/logger";
import { listLanguages, t } from "../services/i18n";

type SettingsModal = {
  open: () => void;
  close: () => void;
};

export const mountSettingsModal = (root: HTMLElement): SettingsModal => {
  let isOpen = false;
  const overlay = document.createElement("div");
  overlay.className = "settings-modal";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="settings-modal__panel">
      <div class="settings-modal__loading" data-settings-loading>
        <div class="settings-modal__spinner"></div>
        <div class="settings-modal__loading-text">${t("settings.applying")}</div>
      </div>
      <div class="settings-modal__header">
        <h3 class="settings-modal__title">${t("settings.title")}</h3>
        <button class="settings-modal__close" type="button" aria-label="${t("settings.close")}">
          <svg class="settings-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="settings-modal__body">
        <div class="settings-modal__nav">
          <button class="settings-modal__nav-item is-active" data-settings-tab="general">${t("settings.general")}</button>
          <button class="settings-modal__nav-item" data-settings-tab="storage">${t("settings.storage")}</button>
        </div>
        <div class="settings-modal__content">
          <section class="settings-modal__section is-active" data-settings-section="general">
            <div class="settings-row">
              <label class="settings-row__label">
                <input class="settings-row__checkbox" type="checkbox" data-setting-delete-trash />
                ${t("settings.move_to_trash")}
              </label>
              <p class="settings-row__hint">${t("settings.move_to_trash_hint")}</p>
            </div>
            <div class="settings-row">
              <label class="settings-row__label" for="settings-language">
                ${t("settings.language")}
              </label>
              <select class="settings-row__select" id="settings-language" data-setting-language></select>
              <p class="settings-row__hint">${t("settings.language_hint")}</p>
            </div>
            <div class="settings-row">
              <label class="settings-row__label" for="settings-history-retention">
                ${t("settings.history_retention")}
              </label>
              <input class="settings-row__input" type="number" min="1" step="1" id="settings-history-retention" data-setting-history-retention />
              <p class="settings-row__hint">${t("settings.history_retention_hint")}</p>
            </div>
          </section>
          <section class="settings-modal__section" data-settings-section="storage">
            <div class="settings-row">
              <div class="settings-row__label">${t("settings.storage_location")}</div>
              <div class="settings-row__path" data-settings-storage-path>${t("settings.loading")}</div>
              <div class="settings-row__actions">
                <button class="settings-row__button" data-settings-storage-change type="button">${t("settings.storage_change")}</button>
                <button class="settings-row__button settings-row__button--ghost" data-settings-storage-default type="button">${t("settings.storage_default")}</button>
              </div>
              <div class="settings-row__status" data-settings-storage-status></div>
            </div>
            <p class="settings-row__hint">${t("settings.storage_hint")}</p>
          </section>
        </div>
      </div>
      <div class="settings-modal__footer">
        <button class="settings-modal__action" data-settings-apply type="button">${t("settings.apply")}</button>
        <button class="settings-modal__action settings-modal__action--ghost" data-settings-close type="button">${t("settings.close")}</button>
      </div>
    </div>
  `;

  root.appendChild(overlay);

  const closeBtn = overlay.querySelector(".settings-modal__close") as HTMLButtonElement | null;
  const navItems = Array.from(overlay.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));
  const sections = Array.from(overlay.querySelectorAll<HTMLElement>("[data-settings-section]"));
  const deleteTrashInput = overlay.querySelector<HTMLInputElement>("[data-setting-delete-trash]");
  const languageSelect = overlay.querySelector<HTMLSelectElement>("[data-setting-language]");
  const storagePath = overlay.querySelector<HTMLElement>("[data-settings-storage-path]");
  const storageChange = overlay.querySelector<HTMLButtonElement>("[data-settings-storage-change]");
  const storageDefault = overlay.querySelector<HTMLButtonElement>("[data-settings-storage-default]");
  const storageStatus = overlay.querySelector<HTMLElement>("[data-settings-storage-status]");
  const historyRetentionInput = overlay.querySelector<HTMLInputElement>("[data-setting-history-retention]");
  const applyBtn = overlay.querySelector<HTMLButtonElement>("[data-settings-apply]");
  const closeFooterBtn = overlay.querySelector<HTMLButtonElement>("[data-settings-close]");
  const loadingOverlay = overlay.querySelector<HTMLElement>("[data-settings-loading]");

  let draftDeleteToTrash = false;
  let draftLanguage = appStore.getState().language;
  let draftStorageMode: "default" | "custom" = "default";
  let draftStoragePath = "";
  let draftStorageAction: "copy" | "use" | "replace" | "empty" = "copy";
  let draftHistoryRetention = appStore.getState().historyRetentionDays;
  let initialStorageMode: "default" | "custom" = "default";
  let initialStoragePath = "";
  let initialStorageAction: "copy" | "use" | "replace" | "empty" = "copy";
  let initialLanguage = appStore.getState().language;
  let initialHistoryRetention = appStore.getState().historyRetentionDays;
  let defaultStoragePath = "";
  let currentStoragePath = "";

  const formatDefaultPath = () => {
    return "data/<storage>";
  };

  const setStoragePathDisplay = (mode: "default" | "custom", path: string) => {
    if (!storagePath) return;
    if (mode === "default") {
      storagePath.textContent = formatDefaultPath();
      return;
    }
    const normalized = path.replace(/[\\/]+$/, "");
    const separator = normalized.includes("\\") ? "\\" : "/";
    storagePath.textContent = `${normalized}${separator}<storage>`;
  };

  const updateDefaultButtonState = () => {
    if (!storageDefault) return;
    const isDefault = draftStorageMode === "default" && draftStoragePath === "";
    storageDefault.disabled = isDefault;
  };

  const syncState = () => {
    const state = appStore.getState();
    if (deleteTrashInput) {
      draftDeleteToTrash = state.deleteToTrash;
      deleteTrashInput.checked = draftDeleteToTrash;
    }
    if (languageSelect) {
      draftLanguage = state.language;
      initialLanguage = state.language;
      languageSelect.value = draftLanguage;
    }
    if (historyRetentionInput) {
      draftHistoryRetention = state.historyRetentionDays;
      initialHistoryRetention = state.historyRetentionDays;
      historyRetentionInput.value = String(draftHistoryRetention);
    }
    updateDefaultButtonState();
  };

  const setStorageStatus = (message: string, tone: "ok" | "error" | "muted" = "muted") => {
    if (!storageStatus) return;
    storageStatus.textContent = message;
    storageStatus.className = `settings-row__status is-${tone}`;
  };

  const setLoading = (value: boolean) => {
    if (!loadingOverlay) return;
    loadingOverlay.style.display = value ? "flex" : "none";
  };

  const renderLanguageOptions = () => {
    if (!languageSelect) return;
    const options = listLanguages()
      .map((lang) => `<option value="${lang.value}">${lang.label}</option>`)
      .join("");
    languageSelect.innerHTML = options;
  };

  const refreshStoragePath = async () => {
    if (!storagePath) return;
    try {
      defaultStoragePath = await getDefaultStoragePath();
      currentStoragePath = await getDataDir();
      const override = await getStorageOverride();
      if (override) {
        draftStorageMode = "custom";
        draftStoragePath = override;
        draftStorageAction = "use";
      } else {
        draftStorageMode = "default";
        draftStoragePath = "";
        draftStorageAction = "copy";
      }
      initialStorageMode = draftStorageMode;
      initialStoragePath = draftStoragePath;
      initialStorageAction = draftStorageAction;
      setStoragePathDisplay(draftStorageMode, draftStoragePath);
      updateDefaultButtonState();
    } catch (e) {
      storagePath.textContent = t("settings.storage_read_error");
      logError("[settings] storage path failed", e);
    }
  };

  const formatTimestamp = (value: number | null) => {
    if (!value) return t("settings.unknown");
    try {
      return new Date(value * 1000).toLocaleString();
    } catch {
      return t("settings.unknown");
    }
  };

  const openStorageConflictDialog = (info: {
    notesCount: number;
    notebooksCount: number;
    lastNoteAt: number | null;
    lastNoteTitle: string | null;
    path: string;
    valid: boolean;
  }) =>
    new Promise<"cancel" | "use" | "replace">((resolve) => {
      const dialog = document.createElement("div");
      dialog.className = "dialog-overlay";
      dialog.dataset.dialogOverlay = "1";
      const warning = info.valid ? "" : `<p class="storage-dialog__warning">${t("storage.existing_warning")}</p>`;
      dialog.innerHTML = `
        <div class="dialog storage-dialog">
          <div class="dialog__header">
            <h3 class="dialog__title">${t("storage.existing_title")}</h3>
            <button class="dialog__close" type="button" data-storage-cancel="1" aria-label="${t("settings.close")}">
              <svg class="dialog__close-icon" aria-hidden="true">
                <use href="#icon-close"></use>
              </svg>
            </button>
          </div>
          <div class="dialog__body">
            <p>${t("storage.existing_message")}</p>
            ${warning}
            <div class="storage-dialog__meta">
              <div><strong>${t("storage.meta.path")}:</strong> ${info.path}</div>
              <div><strong>${t("storage.meta.notes")}:</strong> ${info.notesCount}</div>
              <div><strong>${t("storage.meta.notebooks")}:</strong> ${info.notebooksCount}</div>
              <div><strong>${t("storage.meta.last_note")}:</strong> ${formatTimestamp(info.lastNoteAt)}</div>
              <div><strong>${t("storage.meta.last_note_title")}:</strong> ${info.lastNoteTitle || t("settings.unknown")}</div>
            </div>
          <p class="storage-dialog__hint">${t("storage.replace_hint")}</p>
          </div>
          <div class="dialog__footer">
            <button class="dialog__button dialog__button--ghost" data-storage-cancel="1">${t("dialog.cancel")}</button>
            <button class="dialog__button" data-storage-use="1">${t("storage.use_existing")}</button>
            <button class="dialog__button dialog__button--danger" data-storage-replace="1">${t("storage.replace")}</button>
          </div>
        </div>
      `;
      const cleanup = () => dialog.remove();
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          cleanup();
          resolve("cancel");
        }
      });
      dialog.querySelectorAll("[data-storage-cancel]").forEach((btn) => {
        btn.addEventListener("click", () => {
          cleanup();
          resolve("cancel");
        });
      });
      dialog.querySelector("[data-storage-use]")?.addEventListener("click", () => {
        cleanup();
        resolve("use");
      });
      dialog.querySelector("[data-storage-replace]")?.addEventListener("click", () => {
        cleanup();
        resolve("replace");
      });
      document.body.appendChild(dialog);
    });

  const openStorageEmptyDialog = (path: string) =>
    new Promise<"copy" | "empty" | "cancel">((resolve) => {
      const dialog = document.createElement("div");
      dialog.className = "dialog-overlay";
      dialog.dataset.dialogOverlay = "1";
      dialog.innerHTML = `
        <div class="dialog storage-dialog">
          <div class="dialog__header">
            <h3 class="dialog__title">${t("storage.empty_title")}</h3>
            <button class="dialog__close" type="button" data-storage-empty-cancel="1" aria-label="${t("settings.close")}">
              <svg class="dialog__close-icon" aria-hidden="true">
                <use href="#icon-close"></use>
              </svg>
            </button>
          </div>
          <div class="dialog__body">
            <p>${t("storage.empty_message")}</p>
            <div class="storage-dialog__meta">
              <div><strong>${t("storage.meta.path")}:</strong> ${path}</div>
            </div>
          </div>
          <div class="dialog__footer">
            <button class="dialog__button dialog__button--ghost" data-storage-empty-cancel="1">${t("storage.empty_choose")}</button>
            <button class="dialog__button" data-storage-empty-copy="1">${t("storage.empty_copy")}</button>
            <button class="dialog__button dialog__button--primary" data-storage-empty-create="1">${t("storage.empty_create")}</button>
          </div>
        </div>
      `;
      const cleanup = () => dialog.remove();
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          cleanup();
          resolve("cancel");
        }
      });
      dialog.querySelectorAll("[data-storage-empty-cancel]").forEach((btn) => {
        btn.addEventListener("click", () => {
          cleanup();
          resolve("cancel");
        });
      });
      dialog.querySelector("[data-storage-empty-copy]")?.addEventListener("click", () => {
        cleanup();
        resolve("copy");
      });
      dialog.querySelector("[data-storage-empty-create]")?.addEventListener("click", () => {
        cleanup();
        resolve("empty");
      });
      document.body.appendChild(dialog);
    });

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
          <p>${t("storage.restart_message")}</p>
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

  const openLanguageRestartDialog = () => {
    const dialog = document.createElement("div");
    dialog.className = "dialog-overlay";
    dialog.dataset.dialogOverlay = "1";
    dialog.innerHTML = `
      <div class="dialog storage-dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${t("language.restart_title")}</h3>
        </div>
        <div class="dialog__body">
          <p>${t("language.restart_message")}</p>
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

  const setActiveTab = (id: string) => {
    navItems.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.settingsTab === id);
    });
    sections.forEach((section) => {
      section.classList.toggle("is-active", section.dataset.settingsSection === id);
    });
  };

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.settingsTab;
      if (!id) return;
      setActiveTab(id);
    });
  });

  deleteTrashInput?.addEventListener("change", () => {
    draftDeleteToTrash = Boolean(deleteTrashInput.checked);
  });

  languageSelect?.addEventListener("change", () => {
    if (!languageSelect) return;
    draftLanguage = languageSelect.value as typeof draftLanguage;
  });
  historyRetentionInput?.addEventListener("input", () => {
    if (!historyRetentionInput) return;
    const parsed = Number(historyRetentionInput.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      draftHistoryRetention = Math.floor(parsed);
    }
  });

  storageChange?.addEventListener("click", async () => {
    setStorageStatus("", "muted");
    const selected = await open({
      title: t("settings.storage_select_title"),
      directory: true,
      multiple: false,
    });
    if (!selected || typeof selected !== "string") return;
    if (selected === currentStoragePath || selected === draftStoragePath) return;
    try {
      const info = await getStorageInfo(selected);
      if (info.hasData) {
        const choice = await openStorageConflictDialog({ ...info, path: selected, valid: info.valid });
        if (choice === "cancel") return;
        draftStorageMode = "custom";
        draftStoragePath = selected;
        draftStorageAction = choice;
        setStoragePathDisplay(draftStorageMode, draftStoragePath);
        updateDefaultButtonState();
        return;
      }
      const emptyChoice = await openStorageEmptyDialog(selected);
      if (emptyChoice === "cancel") {
        setStorageStatus(t("settings.storage_select_other"), "muted");
        return;
      }
      draftStorageMode = "custom";
      draftStoragePath = selected;
      draftStorageAction = emptyChoice;
      setStoragePathDisplay(draftStorageMode, draftStoragePath);
      updateDefaultButtonState();
    } catch (e) {
      logError("[settings] storage info failed", e);
    }
  });

  storageDefault?.addEventListener("click", () => {
    const applyDefault = () => {
      draftStorageMode = "default";
      draftStoragePath = "";
      draftStorageAction = "copy";
      setStoragePathDisplay(draftStorageMode, draftStoragePath);
      updateDefaultButtonState();
    };
    if (draftStorageMode === "default" && draftStoragePath === "") return;
    if (!defaultStoragePath) {
      applyDefault();
      return;
    }
    getStorageInfo(defaultStoragePath)
      .then(async (info) => {
        if (!info.hasData) {
          const emptyChoice = await openStorageEmptyDialog(defaultStoragePath);
          if (emptyChoice === "cancel") {
            setStorageStatus(t("settings.storage_status_default"), "muted");
            return;
          }
          draftStorageMode = "default";
          draftStoragePath = "";
          draftStorageAction = emptyChoice;
          setStoragePathDisplay(draftStorageMode, draftStoragePath);
          updateDefaultButtonState();
          return;
        }
        const choice = await openStorageConflictDialog({ ...info, path: defaultStoragePath, valid: info.valid });
        if (choice === "cancel") return;
        draftStorageMode = "default";
        draftStoragePath = "";
        draftStorageAction = choice;
        setStoragePathDisplay(draftStorageMode, draftStoragePath);
        updateDefaultButtonState();
      })
      .catch((e) => {
        logError("[settings] storage info failed", e);
        applyDefault();
      });
  });

  applyBtn?.addEventListener("click", async () => {
    setStorageStatus("", "muted");
    setLoading(true);
    appStore.setState({ deleteToTrash: draftDeleteToTrash, language: draftLanguage, historyRetentionDays: draftHistoryRetention });
    const languageChanged = draftLanguage !== initialLanguage;
    const historyRetentionChanged = draftHistoryRetention !== initialHistoryRetention;
    const storageChanged =
      draftStorageMode !== initialStorageMode ||
      (draftStorageMode === "custom" && draftStoragePath !== initialStoragePath) ||
      (draftStorageAction !== initialStorageAction);
    if (storageChanged) {
      try {
        if (draftStorageMode === "custom") {
          if (draftStorageAction === "use") {
            await setStoragePathExisting(draftStoragePath);
          } else if (draftStorageAction === "replace") {
            await setStoragePathReplace(draftStoragePath);
          } else if (draftStorageAction === "empty") {
            await setStoragePathEmpty(draftStoragePath);
          } else {
            await setStoragePath(draftStoragePath);
          }
        } else {
          if (draftStorageAction === "use") {
            await setStorageDefaultExisting();
          } else if (draftStorageAction === "replace") {
            await setStorageDefaultReplace();
          } else if (draftStorageAction === "empty") {
            await setStorageDefaultEmpty();
          } else {
            await setStorageDefault();
          }
        }
        if (languageChanged) {
          try {
            await invoke("set_settings", { settings: { language: draftLanguage } });
          } catch (e) {
            logError("[settings] language update failed", e);
          }
        }
        initialStorageMode = draftStorageMode;
        initialStoragePath = draftStoragePath;
        initialStorageAction = draftStorageAction;
        setStorageStatus(t("settings.storage_update_success"), "ok");
        setLoading(false);
        closeModal();
        openRestartDialog();
        return;
      } catch (e) {
        logError("[settings] storage update failed", e);
        setStorageStatus(t("settings.storage_update_failed"), "error");
        setLoading(false);
        return;
      }
    }
    setLoading(false);
    closeModal();
    if (historyRetentionChanged) {
      try {
        await invoke("cleanup_note_history", { days: draftHistoryRetention });
      } catch (e) {
        logError("[settings] history retention cleanup failed", e);
      }
    }
    if (languageChanged) {
      try {
        await invoke("set_settings", { settings: { language: draftLanguage } });
      } catch (e) {
        logError("[settings] language update failed", e);
      }
      openLanguageRestartDialog();
    }
  });

  const openModal = () => {
    if (isOpen) return;
    isOpen = true;
    overlay.style.display = "flex";
    renderLanguageOptions();
    syncState();
    setStorageStatus("", "muted");
    refreshStoragePath();
  };

  const closeModal = () => {
    if (!isOpen) return;
    isOpen = false;
    overlay.style.display = "none";
  };

  closeBtn?.addEventListener("click", closeModal);
  closeFooterBtn?.addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (!isOpen) return;
    if (event.key === "Escape") closeModal();
  });

  return { open: openModal, close: closeModal };
};
