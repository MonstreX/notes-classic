import { invoke } from "@tauri-apps/api/core";

export const getDataDir = () => invoke<string>("get_data_dir");

export const setStoragePath = (path: string) =>
  invoke<void>("set_storage_path", { path });
