import { invoke } from "@tauri-apps/api/core";

export const getDataDir = () => invoke<string>("get_data_dir");

export const setStoragePath = (path: string) =>
  invoke<void>("set_storage_path", { path });

export const getStorageOverride = () =>
  invoke<string | null>("get_storage_override");

export const setStorageDefault = () =>
  invoke<void>("set_storage_default");

export type StorageInfo = {
  hasData: boolean;
  notesCount: number;
  notebooksCount: number;
  lastNoteAt: number | null;
  lastNoteTitle: string | null;
};

export const getDefaultStoragePath = () =>
  invoke<string>("get_default_storage_path");

export const getStorageInfo = (path: string) =>
  invoke<StorageInfo>("get_storage_info", { path });

export const setStoragePathExisting = (path: string) =>
  invoke<void>("set_storage_path_existing", { path });

export const setStoragePathReplace = (path: string) =>
  invoke<void>("set_storage_path_replace", { path });

export const setStorageDefaultExisting = () =>
  invoke<void>("set_storage_default_existing");

export const setStorageDefaultReplace = () =>
  invoke<void>("set_storage_default_replace");
