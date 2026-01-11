import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createWorker } from "tesseract.js";

type OcrPendingFile = {
  fileId: number;
  filePath: string;
  mime?: string | null;
};

export type OcrStats = {
  total: number;
  done: number;
  pending: number;
};

export type OcrRuntimeStatus = "running" | "paused";

const OCR_LANGS = ["eng", "rus"];
const OCR_LANG = OCR_LANGS.join("+");
const BATCH_SIZE = 2;
const IDLE_DELAY_MS = 30000;
const RETRY_DELAY_MS = 5000;
const MAX_WORKER_FAILURES = 3;
const OCR_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "jfif", "tif", "tiff"]);
const WORKER_START_TIMEOUT_MS = 120000;

let dataDirPromise: Promise<string> | null = null;
let resourceDirPromise: Promise<string> | null = null;
let runtimeStatus: OcrRuntimeStatus = "running";
let workerBlobUrl: string | null = null;
let workerReject: ((error: Error) => void) | null = null;
let currentFetchAbort: AbortController | null = null;

const logOcr = async (_message: string) => {};

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
  const base = normalizePath(await getResourceDir());
  const workerAssetPath = convertFileSrc(`${base}/ocr/worker.min.js`);
  let workerPath = workerAssetPath;
  try {
    const response = await fetch(workerAssetPath);
    if (response.ok) {
      const code = await response.text();
      const blob = new Blob([code], { type: "application/javascript" });
      if (workerBlobUrl) {
        URL.revokeObjectURL(workerBlobUrl);
      }
      workerBlobUrl = URL.createObjectURL(blob);
      workerPath = workerBlobUrl;
    }
  } catch {
    // fall back to asset path
  }
  const corePath = convertFileSrc(`${base}/ocr/tesseract-core.wasm.js`);
  const langPath = await getLangPath();
  await logOcr(`[worker] init workerPath=${workerPath}`);
  await logOcr(`[worker] init corePath=${corePath}`);
  await logOcr(`[worker] init langPath=${langPath}`);
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
  let consecutiveFailures = 0;
  let isRunning = false;
  let stopPromise: Promise<void> | null = null;
  runtimeStatus = "running";

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
    workerReject = null;
    if (workerBlobUrl) {
      URL.revokeObjectURL(workerBlobUrl);
      workerBlobUrl = null;
    }
  };

  const pauseQueue = () => {
    runtimeStatus = "paused";
    cancelled = true;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const handleFailure = async (error: unknown) => {
    console.error("[ocr] failed", error);
    consecutiveFailures += 1;
    await resetWorker();
    if (consecutiveFailures >= MAX_WORKER_FAILURES) {
      pauseQueue();
      return false;
    }
    return true;
  };

  const getWorker = async () => {
    if (!workerPromise) {
      workerPromise = new Promise<OcrWorker>((resolve, reject) => {
        workerReject = reject;
        withTimeout(buildWorker(), WORKER_START_TIMEOUT_MS, "worker-start")
          .then((instance) => {
            worker = instance;
            resolve(instance);
          })
          .catch((err) => {
            reject(err);
          })
          .finally(() => {
            workerReject = null;
            if (!worker) {
              workerPromise = null;
            }
          });
      });
    }
    return workerPromise;
  };

  const run = async () => {
    if (cancelled) return;
    isRunning = true;
    try {
      const files = await invoke<OcrPendingFile[]>("get_ocr_pending_files", { limit: BATCH_SIZE });
      if (!files.length) {
        schedule(IDLE_DELAY_MS);
        return;
      }
      consecutiveFailures = 0;
      const workerInstance = await getWorker();
      for (const file of files) {
        if (cancelled) return;
        const ext = getExtension(file.filePath);
        const isImageMime = (file.mime || "").toLowerCase().startsWith("image/");
        if (!OCR_EXTENSIONS.has(ext) && !isImageMime) {
          if (cancelled) return;
          await markOcrFailed(file.fileId, "unsupported");
          continue;
        }
        const url = await getFileUrl(file.filePath);
        currentFetchAbort = new AbortController();
        const response = await fetch(url, { signal: currentFetchAbort.signal });
        currentFetchAbort = null;
        if (!response.ok) {
          console.warn("[ocr] fetch failed", file.filePath, response.status);
          if (cancelled) return;
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
          if (cancelled) return;
          await markOcrFailed(file.fileId, "recognize");
          const shouldRetry = await handleFailure(err);
          if (!shouldRetry) return;
          continue;
        }
        if (cancelled) return;
        await markOcrDone(file.fileId, hash, cleaned);
        consecutiveFailures = 0;
      }
      schedule(0);
    } catch (e) {
      const shouldRetry = await handleFailure(e);
      if (!shouldRetry) return;
      schedule(RETRY_DELAY_MS);
    } finally {
      isRunning = false;
    }
  };

  schedule(1000);

  return async () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      cancelled = true;
      runtimeStatus = "paused";
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (currentFetchAbort) {
        currentFetchAbort.abort();
        currentFetchAbort = null;
      }
      if (workerReject) {
        workerReject(new Error("ocr stopped"));
        workerReject = null;
      }
      await resetWorker();
      while (isRunning) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      stopPromise = null;
    })();
    return stopPromise;
  };
};

export const getOcrStats = () => invoke<OcrStats>("get_ocr_stats");
export const getOcrRuntimeStatus = () => runtimeStatus;
