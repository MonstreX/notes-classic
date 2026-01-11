import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError } from "./logger";
import { t } from "./i18n";

type NotesClassicScanSummary = {
  sourceRoot: string;
  noteCount: number;
  notebookCount: number;
  tagCount: number;
  attachmentCount: number;
  imageCount: number;
  valid: boolean;
  errors: string[];
};

type NotesClassicImportReport = {
  startedAt: string;
  finishedAt: string;
  sourceRoot: string;
  targetDataDir: string;
  backupDir: string;
  failed: boolean;
  summary: NotesClassicScanSummary;
  stats: {
    notes: number;
    notebooks: number;
    tags: number;
    attachments: number;
    images: number;
  };
  errors: string[];
};

type ExportManifest = {
  notebooks?: unknown[];
  notes?: unknown[];
  notes_text?: unknown[];
  tags?: unknown[];
  note_tags?: unknown[];
  attachments?: unknown[];
  ocr_files?: unknown[];
  note_files?: unknown[];
  ocr_text?: unknown[];
  note_history?: unknown[];
};

type StageUpdate = {
  stage: "notes" | "attachments" | "database";
  current: number;
  total: number;
  state?: "running" | "done" | "error";
  message?: string;
};

const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
const pathIsDir = (path: string) => invoke<boolean>("path_is_dir", { path });
const readFileBytes = (path: string) => invoke<number[]>("read_file_bytes", { path });
const getDataDir = () => invoke<string>("get_data_dir");
const createBackup = () => invoke<string>("create_import_backup", { kind: "notes-classic" });
const saveBytesAs = (destPath: string, bytes: number[]) =>
  invoke<void>("save_bytes_as", { destPath, bytes });
const importNotesClassic = (manifestPath: string, backupDir: string) =>
  invoke<{
    notes: number;
    notebooks: number;
    tags: number;
    attachments: number;
    images: number;
    errors: string[];
  }>("import_notes_classic_from_manifest", { manifestPath, backupDir });

const safeCount = (value: unknown) => (Array.isArray(value) ? value.length : 0);

const parseManifest = (bytes: number[]) => {
  const raw = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
  return JSON.parse(raw) as ExportManifest;
};

export const scanNotesClassicSource = async (root: string): Promise<NotesClassicScanSummary> => {
  const errors: string[] = [];
  if (!root) {
    return {
      sourceRoot: "",
      noteCount: 0,
      notebookCount: 0,
      tagCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [t("import_notes_classic.scan_failed_generic")],
    };
  }
  const exists = await pathExists(root);
  const isDir = exists ? await pathIsDir(root) : false;
  if (!exists || !isDir) {
    return {
      sourceRoot: root,
      noteCount: 0,
      notebookCount: 0,
      tagCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [t("import_notes_classic.scan_failed_generic")],
    };
  }
  const manifestPath = `${root}/manifest.json`;
  const manifestExists = await pathExists(manifestPath);
  if (!manifestExists) {
    return {
      sourceRoot: root,
      noteCount: 0,
      notebookCount: 0,
      tagCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [t("import_notes_classic.scan_failed_generic")],
    };
  }
  let unlisten: (() => void) | undefined;
  try {
    const bytes = await readFileBytes(manifestPath);
    const manifest = parseManifest(bytes);
    return {
      sourceRoot: root,
      noteCount: safeCount(manifest.notes),
      notebookCount: safeCount(manifest.notebooks),
      tagCount: safeCount(manifest.tags),
      attachmentCount: safeCount(manifest.attachments),
      imageCount: safeCount(manifest.ocr_files),
      valid: safeCount(manifest.notes) > 0,
      errors,
    };
  } catch (e) {
    logError("[import] notes-classic scan failed", e);
    errors.push(String(e));
    return {
      sourceRoot: root,
      noteCount: 0,
      notebookCount: 0,
      tagCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors,
    };
  }
};

export const runNotesClassicImport = async (
  root: string,
  onProgress?: (update: StageUpdate) => void,
  onStatus?: (message: string) => void,
  summaryOverride?: NotesClassicScanSummary
) => {
  const report: NotesClassicImportReport = {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    sourceRoot: root,
    targetDataDir: "",
    backupDir: "",
    failed: false,
    summary: {
      sourceRoot: root,
      noteCount: 0,
      notebookCount: 0,
      tagCount: 0,
      attachmentCount: 0,
      imageCount: 0,
      valid: false,
      errors: [],
    },
    stats: {
      notes: 0,
      notebooks: 0,
      tags: 0,
      attachments: 0,
      images: 0,
    },
    errors: [],
  };

  const writeReport = async (payload: NotesClassicImportReport) => {
    if (!payload.backupDir) return "";
    const reportPath = `${payload.backupDir}/import_report.json`;
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload, null, 2)));
    await saveBytesAs(reportPath, bytes);
    return reportPath;
  };

  let unlisten: (() => void) | undefined;
  try {
    onStatus?.(t("import_notes_classic.preparing_manifest"));
    const summary = summaryOverride ?? (await scanNotesClassicSource(root));
    report.summary = summary;
    if (!summary.valid) {
      throw new Error(t("import_notes_classic.scan_failed_generic"));
    }
    onStatus?.(t("import_notes_classic.preparing_backup"));
    const backupDir = await createBackup();
    report.backupDir = backupDir;
    onStatus?.(t("import_notes_classic.preparing_manifest"));
    report.targetDataDir = await getDataDir();
    onProgress?.({ stage: "notes", current: 0, total: summary.noteCount, state: "running" });
    onProgress?.({
      stage: "attachments",
      current: 0,
      total: summary.attachmentCount + summary.imageCount,
      state: "running",
    });
    onProgress?.({ stage: "database", current: 0, total: 1, state: "running" });

    unlisten = await listen<StageUpdate>("import-notes-classic-progress", (event) => {
      if (!event.payload) return;
      onProgress?.(event.payload);
    });
    onStatus?.(t("import_notes_classic.preparing_import"));
    const manifestPath = `${root}/manifest.json`;
    const result = await importNotesClassic(manifestPath, backupDir);
    report.stats.notes = result.notes;
    report.stats.notebooks = result.notebooks;
    report.stats.tags = result.tags;
    report.stats.attachments = result.attachments;
    report.stats.images = result.images;
    if (result.errors.length) {
      report.errors.push(...result.errors);
    }

    onProgress?.({
      stage: "notes",
      current: summary.noteCount,
      total: summary.noteCount,
      state: "done",
    });
    onProgress?.({
      stage: "attachments",
      current: summary.attachmentCount + summary.imageCount,
      total: summary.attachmentCount + summary.imageCount,
      state: "done",
    });
    onProgress?.({ stage: "database", current: 1, total: 1, state: "done" });

    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    return report;
  } catch (e) {
    report.finishedAt = new Date().toISOString();
    report.failed = true;
    report.errors.push(String(e));
    logError("[import] notes-classic failed", e);
    await writeReport(report);
    return report;
  } finally {
    unlisten?.();
  }
};
