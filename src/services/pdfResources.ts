import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PdfAvailability = {
  available: boolean;
  missing: string[];
};

export type ResourceDownloadProgress = {
  stage: string;
  current: number;
  total: number;
  file: string;
  index: number;
  count: number;
};

export const getPdfAvailability = () => invoke<PdfAvailability>("get_pdf_resource_status");

export const installPdfResources = async (
  onProgress: (payload: ResourceDownloadProgress) => void,
) => {
  const unlisten = await listen<ResourceDownloadProgress>("pdf-download-progress", (event) => {
    onProgress(event.payload);
  });
  try {
    await invoke("download_pdf_resources");
  } finally {
    unlisten();
  }
};
