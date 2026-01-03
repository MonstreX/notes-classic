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
const OCR_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "jfif", "tif", "tiff"]);

let dataDirPromise: Promise<string> | null = null;
let resourceDirPromise: Promise<string> | null = null;

const getDataDir = async () => {
  if (!dataDirPromise) {
    dataDirPromise = invoke<string>("get_data_dir");
  }
  return dataDirPromise;
};

const getResourceDir = async () => {
  if (!resourceDirPromise) {
    resourceDirPromise = invoke<string>("get_resource_dir");
  }
  return resourceDirPromise;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
const getExtension = (value: string) => {
  const cleaned = value.split("?")[0].split("#")[0];
  const part = cleaned.split("/").pop() || "";
  const idx = part.lastIndexOf(".");
  if (idx === -1) return "";
  return part.slice(idx + 1).toLowerCase();
};

const getLangPath = async () => {
  const base = normalizePath(await getResourceDir());
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

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

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

const markOcrDone = async (fileId: number, hash: string, text: string) =>
  invoke("upsert_ocr_text", {
    fileId,
    lang: OCR_LANG,
    text,
    hash,
  });

const markOcrFailed = async (fileId: number, message: string) =>
  invoke("mark_ocr_failed", {
    fileId,
    message,
  });


const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string) => {
  let timer: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`[ocr] ${label} timeout`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
};

export const startOcrQueue = () => {
  let cancelled = false;
  let timer: number | null = null;
  let workerPromise: Promise<OcrWorker> | null = null;
  let worker: OcrWorker | null = null;

  const schedule = (delay: number) => {
    if (cancelled) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  };

  const resetWorker = async () => {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn("[ocr] terminate failed", e);
      }
    }
    worker = null;
    workerPromise = null;
  };

  const getWorker = async () => {
    if (!workerPromise) {
      workerPromise = withTimeout(buildWorker(), 30000, "worker-start")
        .then((instance) => {
          worker = instance;
          return instance;
        })
        .catch((err) => {
          workerPromise = null;
          throw err;
        });
    }
    return workerPromise;
  };

  const run = async () => {
    if (cancelled) return;
    try {
      const files = await invoke<OcrPendingFile[]>("get_ocr_pending_files", { limit: BATCH_SIZE });
      if (!files.length) {
        schedule(IDLE_DELAY_MS);
        return;
      }
      const workerInstance = await getWorker();
      for (const file of files) {
        if (cancelled) return;
        const ext = getExtension(file.filePath);
        if (!OCR_EXTENSIONS.has(ext)) {
          await markOcrFailed(file.fileId, "unsupported");
          continue;
        }
        const url = await getFileUrl(file.filePath);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn("[ocr] fetch failed", file.filePath, response.status);
          await markOcrFailed(file.fileId, `fetch-${response.status}`);
          continue;
        }
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const hash = await hashBuffer(buffer);
        let cleaned = "";
        try {
          const result = await withTimeout(workerInstance.recognize(blob), 60000, "recognize");
          const text = normalizeText(result.data.text || "");
          cleaned = text;
        } catch (err) {
          console.error("[ocr] recognize failed", file.filePath, err);
          await markOcrFailed(file.fileId, "recognize");
          await resetWorker();
          continue;
        }
        await markOcrDone(file.fileId, hash, cleaned);
      }
      schedule(0);
    } catch (e) {
      console.error("[ocr] failed", e);
      await resetWorker();
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
