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
  setStoragePath,
  setStoragePathExisting,
  setStoragePathReplace,
} from "../services/storage";
import { logError } from "../services/logger";

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
        <div class="settings-modal__loading-text">Applying...</div>
      </div>
      <div class="settings-modal__header">
        <h3 class="settings-modal__title">Settings</h3>
        <button class="settings-modal__close" type="button" aria-label="Close">
          <svg class="settings-modal__close-icon" width="16" height="16" aria-hidden="true">
            <use href="#icon-close"></use>
          </svg>
        </button>
      </div>
      <div class="settings-modal__body">
        <div class="settings-modal__nav">
          <button class="settings-modal__nav-item is-active" data-settings-tab="general">General</button>
          <button class="settings-modal__nav-item" data-settings-tab="storage">Storage</button>
        </div>
        <div class="settings-modal__content">
          <section class="settings-modal__section is-active" data-settings-section="general">
            <div class="settings-row">
              <label class="settings-row__label">
                <input class="settings-row__checkbox" type="checkbox" data-setting-delete-trash />
                Move deleted notes to Trash
              </label>
              <p class="settings-row__hint">Disable to delete notes permanently.</p>
            </div>
          </section>
          <section class="settings-modal__section" data-settings-section="storage">
            <div class="settings-row">
              <div class="settings-row__label">Storage location</div>
              <div class="settings-row__path" data-settings-storage-path>Loading...</div>
              <div class="settings-row__actions">
                <button class="settings-row__button" data-settings-storage-change type="button">Change...</button>
                <button class="settings-row__button settings-row__button--ghost" data-settings-storage-default type="button">Default</button>
              </div>
              <div class="settings-row__status" data-settings-storage-status></div>
            </div>
            <p class="settings-row__hint">Changing location copies data. Restart required.</p>
          </section>
        </div>
      </div>
      <div class="settings-modal__footer">
        <button class="settings-modal__action" data-settings-apply type="button">Apply</button>
        <button class="settings-modal__action settings-modal__action--ghost" data-settings-close type="button">Close</button>
      </div>
    </div>
  `;

  root.appendChild(overlay);

  const closeBtn = overlay.querySelector(".settings-modal__close") as HTMLButtonElement | null;
  const navItems = Array.from(overlay.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));
  const sections = Array.from(overlay.querySelectorAll<HTMLElement>("[data-settings-section]"));
  const deleteTrashInput = overlay.querySelector<HTMLInputElement>("[data-setting-delete-trash]");
  const storagePath = overlay.querySelector<HTMLElement>("[data-settings-storage-path]");
  const storageChange = overlay.querySelector<HTMLButtonElement>("[data-settings-storage-change]");
  const storageDefault = overlay.querySelector<HTMLButtonElement>("[data-settings-storage-default]");
  const storageStatus = overlay.querySelector<HTMLElement>("[data-settings-storage-status]");
  const applyBtn = overlay.querySelector<HTMLButtonElement>("[data-settings-apply]");
  const closeFooterBtn = overlay.querySelector<HTMLButtonElement>("[data-settings-close]");
  const loadingOverlay = overlay.querySelector<HTMLElement>("[data-settings-loading]");

  let draftDeleteToTrash = false;
  let draftStorageMode: "default" | "custom" = "default";
  let draftStoragePath = "";
  let draftStorageAction: "copy" | "use" | "replace" = "copy";
  let initialStorageMode: "default" | "custom" = "default";
  let initialStoragePath = "";
  let initialStorageAction: "copy" | "use" | "replace" = "copy";
  let defaultStoragePath = "";

  const formatDefaultPath = () => {
    if (!defaultStoragePath) return "\\data\\<storage>";
    return "\\data\\<storage>";
  };

  const setStoragePathDisplay = (mode: "default" | "custom", path: string) => {
    if (!storagePath) return;
    if (mode === "default") {
      storagePath.textContent = formatDefaultPath();
      return;
    }
    const normalized = path.replace(/[\\/]+$/, "");
    storagePath.textContent = `${normalized}\\<storage>`;
  };

  const syncState = () => {
    const state = appStore.getState();
    if (deleteTrashInput) {
      draftDeleteToTrash = state.deleteToTrash;
      deleteTrashInput.checked = draftDeleteToTrash;
    }
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

  const refreshStoragePath = async () => {
    if (!storagePath) return;
    try {
      defaultStoragePath = await getDefaultStoragePath();
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
    } catch (e) {
      storagePath.textContent = "Unable to read";
      logError("[settings] storage path failed", e);
    }
  };

  const formatTimestamp = (value: number | null) => {
    if (!value) return "Unknown";
    try {
      return new Date(value * 1000).toLocaleString("en-US");
    } catch {
      return "Unknown";
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
      const warning = info.valid ? "" : `<p class="storage-dialog__warning">This storage looks incompatible or corrupted. Use with caution.</p>`;
      dialog.innerHTML = `
        <div class="dialog storage-dialog">
          <div class="dialog__header">
            <h3 class="dialog__title">Existing storage found</h3>
          </div>
          <div class="dialog__body">
            <p>This folder already contains notes data.</p>
            ${warning}
            <div class="storage-dialog__meta">
              <div><strong>Path:</strong> ${info.path}</div>
              <div><strong>Notes:</strong> ${info.notesCount}</div>
              <div><strong>Notebooks:</strong> ${info.notebooksCount}</div>
              <div><strong>Last note:</strong> ${formatTimestamp(info.lastNoteAt)}</div>
              <div><strong>Last note title:</strong> ${info.lastNoteTitle || "Unknown"}</div>
            </div>
            <p class="storage-dialog__hint">Replace will overwrite notes.db, files, and ocr folders only.</p>
          </div>
          <div class="dialog__footer">
            <button class="dialog__button dialog__button--ghost" data-storage-cancel="1">Cancel</button>
            <button class="dialog__button" data-storage-use="1">Use existing</button>
            <button class="dialog__button dialog__button--danger" data-storage-replace="1">Replace</button>
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
      dialog.querySelector("[data-storage-cancel]")?.addEventListener("click", () => {
        cleanup();
        resolve("cancel");
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

  storageChange?.addEventListener("click", async () => {
    setStorageStatus("", "muted");
    const selected = await open({
      title: "Select storage folder",
      directory: true,
      multiple: false,
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const info = await getStorageInfo(selected);
      if (info.hasData) {
        const choice = await openStorageConflictDialog({ ...info, path: selected, valid: info.valid });
        if (choice === "cancel") return;
        draftStorageMode = "custom";
        draftStoragePath = selected;
        draftStorageAction = choice;
        setStoragePathDisplay(draftStorageMode, draftStoragePath);
        return;
      }
      draftStorageMode = "custom";
      draftStoragePath = selected;
      draftStorageAction = "copy";
      setStoragePathDisplay(draftStorageMode, draftStoragePath);
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
    };
    if (!defaultStoragePath) {
      applyDefault();
      return;
    }
    getStorageInfo(defaultStoragePath)
      .then(async (info) => {
        if (!info.hasData) {
          applyDefault();
          return;
        }
        const choice = await openStorageConflictDialog({ ...info, path: defaultStoragePath, valid: info.valid });
        if (choice === "cancel") return;
        draftStorageMode = "default";
        draftStoragePath = "";
        draftStorageAction = choice;
        setStoragePathDisplay(draftStorageMode, draftStoragePath);
      })
      .catch((e) => {
        logError("[settings] storage info failed", e);
        applyDefault();
      });
  });

  applyBtn?.addEventListener("click", async () => {
    setStorageStatus("", "muted");
    setLoading(true);
    appStore.setState({ deleteToTrash: draftDeleteToTrash });
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
          } else {
            await setStoragePath(draftStoragePath);
          }
        } else {
          if (draftStorageAction === "use") {
            await setStorageDefaultExisting();
          } else if (draftStorageAction === "replace") {
            await setStorageDefaultReplace();
          } else {
            await setStorageDefault();
          }
        }
        initialStorageMode = draftStorageMode;
        initialStoragePath = draftStoragePath;
        initialStorageAction = draftStorageAction;
        setStorageStatus("Storage updated. Restart required.", "ok");
        setLoading(false);
        closeModal();
        return;
      } catch (e) {
        logError("[settings] storage update failed", e);
        setStorageStatus("Failed to update storage location.", "error");
        setLoading(false);
        return;
      }
    }
    setLoading(false);
    closeModal();
  });

  const openModal = () => {
    if (isOpen) return;
    isOpen = true;
    overlay.style.display = "flex";
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
