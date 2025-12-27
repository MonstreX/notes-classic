import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../store";
import { appStore } from "../store";

const STORAGE_KEY = "notes_classic_v10_stable";
let saveSettingsTimer: number | null = null;

export const persistSettings = (state: AppState) => {
  if (saveSettingsTimer !== null) window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(() => {
    const payload = {
      sidebarWidth: state.sidebarWidth,
      listWidth: state.listWidth,
      selectedNotebookId: state.selectedNotebookId,
      selectedNoteId: state.selectedNoteId,
      expandedNotebooks: Array.from(state.expandedNotebooks),
      notesListView: state.notesListView,
    };
    invoke("set_settings", { settings: payload }).catch(() => {});
  }, 200);
};

const migrateLegacyStorage = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    localStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch (e) {
    return null;
  }
};

export const loadSettings = async () => {
  try {
    const stored = await invoke<any>("get_settings");
    if (stored) {
      appStore.update((draft) => {
        if (stored.sidebarWidth) draft.sidebarWidth = stored.sidebarWidth;
        if (stored.listWidth) draft.listWidth = stored.listWidth;
        if (stored.selectedNotebookId !== undefined) {
          const parsed = stored.selectedNotebookId === null ? null : Number(stored.selectedNotebookId);
          draft.selectedNotebookId = Number.isFinite(parsed as number) ? (parsed as number) : null;
        }
        if (stored.selectedNoteId !== undefined) {
          const parsed = stored.selectedNoteId === null ? null : Number(stored.selectedNoteId);
          draft.selectedNoteId = Number.isFinite(parsed as number) ? (parsed as number) : null;
        }
        if (stored.expandedNotebooks) {
          const ids = Array.isArray(stored.expandedNotebooks)
            ? stored.expandedNotebooks.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
            : [];
          draft.expandedNotebooks = new Set(ids);
        }
        if (stored.notesListView === "compact" || stored.notesListView === "detailed") {
          draft.notesListView = stored.notesListView;
        }
      });
      return;
    }

    const legacy = migrateLegacyStorage();
    if (legacy) {
      appStore.update((draft) => {
        if (legacy.sidebarWidth) draft.sidebarWidth = legacy.sidebarWidth;
        if (legacy.listWidth) draft.listWidth = legacy.listWidth;
        if (legacy.selectedNotebookId !== undefined) {
          const parsed = legacy.selectedNotebookId === null ? null : Number(legacy.selectedNotebookId);
          draft.selectedNotebookId = Number.isFinite(parsed as number) ? (parsed as number) : null;
        }
        if (legacy.selectedNoteId !== undefined) {
          const parsed = legacy.selectedNoteId === null ? null : Number(legacy.selectedNoteId);
          draft.selectedNoteId = Number.isFinite(parsed as number) ? (parsed as number) : null;
        }
        if (legacy.expandedNotebooks) {
          const ids = Array.isArray(legacy.expandedNotebooks)
            ? legacy.expandedNotebooks.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
            : [];
          draft.expandedNotebooks = new Set(ids);
        }
        if (legacy.notesListView === "compact" || legacy.notesListView === "detailed") {
          draft.notesListView = legacy.notesListView;
        }
      });
      await invoke("set_settings", { settings: legacy });
    }
  } catch (e) {}
};

export const cleanupSettings = () => {
  if (saveSettingsTimer !== null) window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = null;
};
