import { open } from "@tauri-apps/plugin-dialog";
import { appStore } from "../state/store";
import { getDataDir, setStoragePath } from "../services/storage";
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
      <div class="settings-modal__header">
        <h3 class="settings-modal__title">Settings</h3>
        <button class="settings-modal__close" type="button" aria-label="Close">
          ×
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
              <button class="settings-row__button" data-settings-storage-change type="button">Change…</button>
              <div class="settings-row__status" data-settings-storage-status></div>
            </div>
            <p class="settings-row__hint">Changing location copies data. Restart required.</p>
          </section>
        </div>
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
  const storageStatus = overlay.querySelector<HTMLElement>("[data-settings-storage-status]");

  const syncState = () => {
    const state = appStore.getState();
    if (deleteTrashInput) {
      deleteTrashInput.checked = state.deleteToTrash;
    }
  };

  const setStorageStatus = (message: string, tone: "ok" | "error" | "muted" = "muted") => {
    if (!storageStatus) return;
    storageStatus.textContent = message;
    storageStatus.className = `settings-row__status is-${tone}`;
  };

  const refreshStoragePath = async () => {
    if (!storagePath) return;
    try {
      const path = await getDataDir();
      storagePath.textContent = path;
    } catch (e) {
      storagePath.textContent = "Unable to read";
      logError("[settings] storage path failed", e);
    }
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
    appStore.setState({ deleteToTrash: Boolean(deleteTrashInput.checked) });
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
      await setStoragePath(selected);
      storagePath && (storagePath.textContent = selected);
      setStorageStatus("Storage updated. Restart required.", "ok");
    } catch (e) {
      logError("[settings] storage update failed", e);
      setStorageStatus("Failed to update storage location.", "error");
    }
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
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (!isOpen) return;
    if (event.key === "Escape") closeModal();
  });

  return { open: openModal, close: closeModal };
};
