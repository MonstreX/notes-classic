import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createWorker } from "tesseract.js";

type OcrPendingFile = {
  fileId: number;
  filePath: string;
};

export type OcrStats = {
  total: number;
  done: number;
  pending: number;
};

const OCR_LANGS = ["eng", "rus"];
const OCR_LANG = OCR_LANGS.join("+");
const BATCH_SIZE = 2;
const IDLE_DELAY_MS = 30000;
const RETRY_DELAY_MS = 5000;

let dataDirPromise: Promise<string> | null = null;

const getDataDir = async () => {
  if (!dataDirPromise) {
    dataDirPromise = invoke<string>("get_data_dir");
  }
  return dataDirPromise;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");

const getLangPath = async () => {
  const base = normalizePath(await getDataDir());
  return convertFileSrc(`${base}/ocr/tessdata`);
};

const getFileUrl = async (filePath: string) => {
  const base = normalizePath(await getDataDir());
  const rel = filePath.replace(/^\/+/, "").replace(/\\/g, "/");
  return convertFileSrc(`${base}/files/${rel}`);
};

const buildWorker = async () => {
  const workerPath = new URL("tesseract.js/dist/worker.min.js", import.meta.url).toString();
  const corePath = new URL("tesseract.js-core/tesseract-core.wasm.js", import.meta.url).toString();
  const langPath = await getLangPath();
  return createWorker(OCR_LANGS, undefined, {
    workerPath,
    corePath,
    langPath,
    gzip: true,
  });
};

const hashBuffer = async (buffer: ArrayBuffer) => {
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const normalizeText = (value: string) =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const startOcrQueue = () => {
  let cancelled = false;
  let timer: number | null = null;
  let workerPromise: Promise<Awaited<ReturnType<typeof buildWorker>>> | null = null;

  const schedule = (delay: number) => {
    if (cancelled) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  };

  const run = async () => {
    if (cancelled) return;
    try {
      const files = await invoke<OcrPendingFile[]>("get_ocr_pending_files", { limit: BATCH_SIZE });
      if (!files.length) {
        schedule(IDLE_DELAY_MS);
        return;
      }
      if (!workerPromise) {
        workerPromise = buildWorker();
      }
      const worker = await workerPromise;
      for (const file of files) {
        if (cancelled) return;
        const url = await getFileUrl(file.filePath);
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const hash = await hashBuffer(buffer);
        const result = await worker.recognize(blob);
        const text = normalizeText(result.data.text || "");
        await invoke("upsert_ocr_text", {
          fileId: file.fileId,
          lang: OCR_LANG,
          text,
          hash,
        });
      }
      schedule(0);
    } catch (e) {
      console.error("[ocr] failed", e);
      schedule(RETRY_DELAY_MS);
    }
  };

  schedule(1000);

  return () => {
    cancelled = true;
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  };
};

export const getOcrStats = () => invoke<OcrStats>("get_ocr_stats");
