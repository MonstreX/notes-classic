import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { logError } from "./logger";
import { getStorageInfo } from "./storage";
import { t } from "./i18n";

type EvernoteScanSummary = {
  sourceRoot: string;
  dbPath: string;
  rteRoot: string;
  resourcesRoot: string | null;
  resourceRoots: string[];
  noteCount: number;
  notebookCount: number;
  stackCount: number;
  tagCount: number;
  noteTagCount: number;
  attachmentCount: number;
  attachmentBytes: number;
  imageCount: number;
  resourceBytes: number;
  missingRteCount: number;
  valid: boolean;
  errors: string[];
};

type EvernoteImportReport = {
  startedAt: string;
  finishedAt: string;
  sourceRoot: string;
  targetDataDir: string;
  backupDir: string;
  failed: boolean;
  summary: EvernoteScanSummary;
  stats: {
    notes: number;
    notebooks: number;
    tags: number;
    attachments: number;
  };
  missingRte: Array<{ id: string; path: string }>;
  decodeErrors: Array<{ id: string; path: string; error: string }>;
  missingResources: Array<{ noteId: string; hash: string; sourcePath: string }>;
  assetCopyErrors: Array<{ sourcePath: string; destPath: string; error: string }>;
  errors: string[];
};

const readFileBytes = (path: string) => invoke<number[]>("read_file_bytes", { path });
const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
const pathIsDir = (path: string) => invoke<boolean>("path_is_dir", { path });
const getDirSize = (path: string) => invoke<number>("get_dir_size", { path });
const resolveResourceRoots = (path: string) =>
  invoke<string[]>("resolve_resource_roots", { path });
const findEvernotePaths = (basePath: string) =>
  invoke<{ dbPath?: string | null; rteRoot?: string | null; resourcesRoot?: string | null }>("find_evernote_paths", {
    basePath,
  });
const copyFile = (source: string, dest: string) =>
  invoke<void>("copy_file", { source, dest });
const ensureDir = (path: string) => invoke<void>("ensure_dir", { path });
const getDataDir = () => invoke<string>("get_data_dir");
const createBackup = () => invoke<string>("create_evernote_backup");
const runNoteFilesBackfill = () => invoke<void>("run_note_files_backfill");
const importFromJson = (jsonPath: string, assetsDir: string) =>
  invoke<{ notes: number; notebooks: number; tags: number; attachments: number }>("import_evernote_from_json", {
    jsonPath,
    assetsDir,
  });
const saveBytesAs = (destPath: string, bytes: number[]) =>
  invoke<void>("save_bytes_as", { destPath, bytes });

const wasmPath = wasmUrl;

const sanitizeExt = (ext: string | null) => {
  if (!ext) return null;
  const clean = ext.replace(/[^a-zA-Z0-9.]/g, "");
  if (!clean) return null;
  return clean.startsWith(".") ? clean.slice(1).toLowerCase() : clean.toLowerCase();
};

const extFromMime = (mime?: string | null) => {
  if (!mime) return null;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/json": "json",
  };
  return map[mime] || null;
};

const normalizeTimestamp = (value: unknown, fallback: number) => {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num > 1e12) return Math.floor(num / 1000);
  if (num > 1e9) return Math.floor(num);
  return Math.floor(num);
};

const normalizeStackId = (stackId?: string | null) => {
  if (!stackId) return null;
  return stackId.startsWith("Stack:") ? stackId.slice("Stack:".length) : stackId;
};

const normalizeEnmlToHtml = (enml: string) => {
  if (!enml) return "";
  let html = enml;
  const codeblockToken = /<\s*div\b[^>]*--en-codeblock:true[^>]*>/i;
  const divToken = /<\/?div\b[^>]*>/gi;
  let searchIndex = 0;
  while (true) {
    const match = html.slice(searchIndex).match(codeblockToken);
    if (!match || match.index === undefined) break;
    const start = searchIndex + match.index;
    divToken.lastIndex = start;
    let depth = 0;
    let openTagEnd: number | null = null;
    let closeTagStart: number | null = null;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = divToken.exec(html)) !== null) {
      const token = tokenMatch[0];
      const isClosing = token.startsWith("</") || token.startsWith("</ ");
      if (!isClosing) {
        depth += 1;
        if (openTagEnd === null) {
          openTagEnd = divToken.lastIndex;
        }
      } else {
        depth -= 1;
        if (depth === 0) {
          closeTagStart = tokenMatch.index;
          break;
        }
      }
    }
    if (openTagEnd === null || closeTagStart === null) break;
    const inner = html.slice(openTagEnd, closeTagStart);
    html = `${html.slice(0, start)}<note-callout>${inner}</note-callout>${html.slice(divToken.lastIndex)}`;
    searchIndex = start + "<note-callout>".length + inner.length + "</note-callout>".length;
  }
  html = html.replace(/<en-note[^>]*>/gi, "<div>");
  html = html.replace(/<\/en-note>/gi, "</div>");
  html = html.replace(/<br><\/br>/gi, "<br>");
  html = html.replace(/<en-todo([^>]*)\/>/gi, (match, attrs) => {
    const checked = /checked=\"true\"/i.test(attrs);
    return `<input type="checkbox" ${checked ? "checked " : ""}disabled />`;
  });
  html = html.replace(/<div>/gi, "<p>");
  html = html.replace(/<\/div>/gi, "</p>");
  html = html.replace(/<note-callout>/gi, '<div class="note-callout">');
  html = html.replace(/<\/note-callout>/gi, "</div>");
  html = html.replace(/<p>\s*(<div class=\"note-callout\">)/gi, "$1");
  html = html.replace(/<\/div>\s*<\/p>/gi, "</div>");
  let prev = "";
  while (prev !== html) {
    prev = html;
    html = html.replace(/<p>\s*<p>/gi, "<p>");
    html = html.replace(/<\/p>\s*<\/p>/gi, "</p>");
  }
  html = html.replace(/<p>\s*<\/p>/gi, "");
  html = html.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "");
  return html;
};

const rewriteEnml = (enml: string, assetMap: Map<string, string>) => {
  if (!enml) return enml;
  return enml.replace(/<en-media[^>]*?hash=\"([0-9a-f]+)\"[^>]*?(?:><\/en-media>|\s*\/>)/gi, (match, hash) => {
    const rel = assetMap.get(hash);
    if (!rel) return match;
    return `<img data-en-hash="${hash}" src="files/${rel}" />`;
  });
};

const toRowObjects = (stmt: any) => {
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  return rows;
};

const listTables = (db: any) => {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
  const rows = toRowObjects(stmt);
  stmt.free();
  return rows.map((row: any) => row.name);
};

const selectAll = (db: any, sql: string, params: any[] = []) => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = toRowObjects(stmt);
  stmt.free();
  return rows;
};

const readRteDoc = async (rteRoot: string, noteId: string) => {
  const subA = noteId.slice(0, 3);
  const subB = noteId.slice(-3);
  const filePath = `${rteRoot}/${subA}/${subB}/${noteId}.dat`.replace(/\\/g, "/");
  const exists = await pathExists(filePath);
  if (!exists) {
    return { found: false, path: filePath };
  }
  try {
    const updateBytes = await readFileBytes(filePath);
    const update = Uint8Array.from(updateBytes);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const content = doc.getXmlFragment("content").toString();
    const title = doc.getText("title").toString();
    const customNoteStyles = doc.getMap("customNoteStyles").toJSON();
    const meta = doc.getMap("meta").toJSON();
    return { found: true, path: filePath, title, enml: content, customNoteStyles, meta };
  } catch (err) {
    return { found: true, path: filePath, error: String(err) };
  }
};

const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const buildAssetPath = (assetsRoot: string, hash: string, ext: string | null) => {
  const prefix = hash.slice(0, 2);
  const filename = ext ? `${hash}.${ext}` : hash;
  const relPath = `${prefix}/${filename}`;
  const absPath = `${assetsRoot}/${prefix}/${filename}`;
  return { relPath, absPath };
};

const findResourcePath = async (resourceRoots: string[], noteId: string, hash: string) => {
  for (const root of resourceRoots) {
    const candidate = `${root}/${noteId}/${hash}`;
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return resourceRoots.length ? `${resourceRoots[0]}/${noteId}/${hash}` : null;
};

const normalizeEvernoteRoot = (value: string) => {
  let root = value.trim();
  root = root.replace(/[\\\/]*\*+$/, "");
  root = root.replace(/[\\\/]+$/, "");
  return root;
};

const isDeletedNote = (note: any) => {
  const raw = note?.deleted;
  if (raw === null || raw === undefined) return false;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0;
};

export const scanEvernoteSource = async (sourceRoot: string): Promise<EvernoteScanSummary> => {
  const cleanRoot = normalizeEvernoteRoot(sourceRoot);
  const errors: string[] = [];
  if (!(await pathIsDir(cleanRoot))) {
    errors.push("Selected path is not a folder.");
  }
  const resolved = await findEvernotePaths(cleanRoot);
  const dbPath = resolved.dbPath || `${cleanRoot}/RemoteGraph.sql`;
  const rteRoot = resolved.rteRoot || `${cleanRoot}/internal_rteDoc`;
  const resourcesRoot = resolved.resourcesRoot || `${cleanRoot}/resource-cache`;

  const hasDb = await pathExists(dbPath);
  const hasRte = await pathExists(rteRoot);
  if (!hasDb) errors.push("RemoteGraph.sql not found.");
  if (!hasRte) errors.push("internal_rteDoc not found.");

  const resourceRoots = (await pathExists(resourcesRoot))
    ? await resolveResourceRoots(resourcesRoot)
    : [];

  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const dbBytes = hasDb ? await readFileBytes(dbPath) : [];
  const db = hasDb ? new SQL.Database(new Uint8Array(dbBytes)) : null;
  const tables = db ? listTables(db) : [];

  const noteCount = db
    ? Number(
        selectAll(db, "SELECT COUNT(*) AS c FROM Nodes_Note WHERE deleted IS NULL OR deleted = 0")[0]?.c || 0
      )
    : 0;
  const notebookCount = db ? Number(selectAll(db, "SELECT COUNT(*) AS c FROM Nodes_Notebook")[0]?.c || 0) : 0;
  const tagCount = db && tables.includes("Nodes_Tag")
    ? Number(selectAll(db, "SELECT COUNT(*) AS c FROM Nodes_Tag")[0]?.c || 0)
    : 0;
  const noteTagCount = db && tables.includes("NoteTag")
    ? Number(selectAll(db, "SELECT COUNT(*) AS c FROM NoteTag")[0]?.c || 0)
    : 0;
  const attachmentCount = db && tables.includes("Attachment")
    ? Number(
        selectAll(
          db,
          "SELECT COUNT(*) AS c FROM Attachment WHERE parent_Note_id IN (SELECT id FROM Nodes_Note WHERE deleted IS NULL OR deleted = 0)"
        )[0]?.c || 0
      )
    : 0;
  const attachmentBytes = db && attachmentCount
    ? Number(
        selectAll(
          db,
          "SELECT SUM(dataSize) AS s FROM Attachment WHERE parent_Note_id IN (SELECT id FROM Nodes_Note WHERE deleted IS NULL OR deleted = 0)"
        )[0]?.s || 0
      )
    : 0;
  const imageCount = db && attachmentCount
    ? Number(
        selectAll(
          db,
          "SELECT COUNT(*) AS c FROM Attachment WHERE mime LIKE 'image/%' AND parent_Note_id IN (SELECT id FROM Nodes_Note WHERE deleted IS NULL OR deleted = 0)"
        )[0]?.c || 0
      )
    : 0;

  const stackIds = new Set<string>();
  if (db && notebookCount) {
    const notebooks = selectAll(db, "SELECT personal_Stack_id, stack_Stack_id FROM Nodes_Notebook");
    notebooks.forEach((row: any) => {
      const raw = row.personal_Stack_id || row.stack_Stack_id;
      const normalized = normalizeStackId(raw);
      if (normalized) stackIds.add(normalized);
    });
  }

  const resourceBytes = resourcesRoot && (await pathExists(resourcesRoot))
    ? await getDirSize(resourcesRoot)
    : 0;

  let missingRteCount = 0;
  if (db && hasRte) {
    const ids = selectAll(db, "SELECT id FROM Nodes_Note WHERE deleted IS NULL OR deleted = 0");
    if (ids.length) {
      const idList = ids.map((row: any) => String(row.id));
      missingRteCount = Number(await invoke<number>("count_missing_rte", { rteRoot, noteIds: idList }));
    }
  }

  return {
    sourceRoot: cleanRoot,
    dbPath,
    rteRoot,
    resourcesRoot: (await pathExists(resourcesRoot)) ? resourcesRoot : null,
    resourceRoots,
    noteCount,
    notebookCount,
    stackCount: stackIds.size,
    tagCount,
    noteTagCount,
    attachmentCount,
    attachmentBytes,
    imageCount,
    resourceBytes,
    missingRteCount,
    valid: errors.length === 0,
    errors,
  };
};

type EvernoteImportProgress = {
  stage: "tables" | "resources" | "decode" | "database";
  current?: number;
  total?: number;
  state?: "running" | "done" | "error";
  message?: string;
};

export const runEvernoteImport = async (
  summary: EvernoteScanSummary,
  onProgress?: (event: EvernoteImportProgress) => void
): Promise<EvernoteImportReport> => {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const missingRte: Array<{ id: string; path: string }> = [];
  const decodeErrors: Array<{ id: string; path: string; error: string }> = [];
  const missingResources: Array<{ noteId: string; hash: string; sourcePath: string }> = [];
  const assetCopyErrors: Array<{ sourcePath: string; destPath: string; error: string }> = [];

  const dataDir = await getDataDir();
  const storageInfo = await getStorageInfo(dataDir).catch(() => null);
  const shouldBackup = Boolean(
    storageInfo?.hasData &&
      ((storageInfo?.notesCount ?? 0) > 0 || (storageInfo?.notebooksCount ?? 0) > 0)
  );
  const backupDir = shouldBackup
    ? await createBackup()
    : await join(
        await tempDir(),
        "notes-classic",
        `evernote-${new Date().toISOString().replace(/[:.]/g, "-")}`
      );
  if (!shouldBackup) {
    await ensureDir(backupDir);
  }
  const importDir = `${backupDir}/import`;
  const assetsDir = `${importDir}/assets`;
  await ensureDir(assetsDir);

  const writeReport = async (report: EvernoteImportReport) => {
    const reportPath = `${backupDir}/import_report.json`;
    await saveBytesAs(reportPath, Array.from(new TextEncoder().encode(JSON.stringify(report, null, 2))));
  };

  try {
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const dbBytes = await readFileBytes(summary.dbPath);
    const db = new SQL.Database(new Uint8Array(dbBytes));
    const tables = listTables(db);

    onProgress?.({ stage: "tables", state: "running", current: 0, total: 1, message: "Reading Evernote tables..." });
    const notebooks = selectAll(db, "SELECT * FROM Nodes_Notebook");
    const notes = selectAll(db, "SELECT * FROM Nodes_Note");
    const activeNotes = notes.filter((note: any) => !isDeletedNote(note));
    const activeNoteIds = new Set(activeNotes.map((note: any) => String(note.id)));
    const tags = tables.includes("Nodes_Tag") ? selectAll(db, "SELECT * FROM Nodes_Tag") : [];
    const noteTags = tables.includes("NoteTag") ? selectAll(db, "SELECT * FROM NoteTag") : [];
    const attachments = tables.includes("Attachment") ? selectAll(db, "SELECT * FROM Attachment") : [];
    onProgress?.({ stage: "tables", state: "done", current: 1, total: 1, message: "Reading Evernote tables..." });

    const assetMap = new Map<string, string>();
    const attachmentsOut: any[] = [];

    const attachmentTotal = attachments.length;
    onProgress?.({ stage: "resources", state: "running", current: 0, total: attachmentTotal, message: "Copying Evernote resources..." });
    let attachmentIndex = 0;
    for (const attachment of attachments) {
      attachmentIndex += 1;
      const noteId = attachment.parent_Note_id || null;
      if (noteId && !activeNoteIds.has(String(noteId))) {
        if (attachmentIndex === attachmentTotal || attachmentIndex % 10 === 0) {
          onProgress?.({
            stage: "resources",
            state: "running",
            current: attachmentIndex,
            total: attachmentTotal,
            message: "Copying Evernote resources...",
          });
        }
        continue;
      }
      const hash = attachment.dataHash || null;
      if (!hash || !noteId) {
        const attachmentFields = {
          id: attachment.id ?? null,
          filename: attachment.filename ?? null,
          mime: attachment.mime ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          isActive: attachment.isActive ?? null,
          dataHash: attachment.dataHash ?? null,
          dataSize: attachment.dataSize ?? null,
          parent_Note_id: attachment.parent_Note_id ?? null,
          sourceUrl: attachment.sourceUrl ?? attachment.sourceURL ?? attachment.source_url ?? null,
        };
        attachmentsOut.push({ attachmentFields, noteId, dataHash: hash });
        if (attachmentIndex === attachmentTotal || attachmentIndex % 10 === 0) {
          onProgress?.({
            stage: "resources",
            state: "running",
            current: attachmentIndex,
            total: attachmentTotal,
            message: "Copying Evernote resources...",
          });
        }
        continue;
      }
      const filenameRaw = attachment.filename || "";
      const hasDot = filenameRaw.includes(".");
      const extFromName = hasDot ? sanitizeExt(filenameRaw.split(".").slice(-1)[0] || "") : null;
      const ext = extFromName || extFromMime(attachment.mime || "");
      const { relPath, absPath } = buildAssetPath(assetsDir, hash, ext);
      const sourcePath = await findResourcePath(summary.resourceRoots, String(noteId), hash);
      if (!sourcePath || !(await pathExists(sourcePath))) {
        missingResources.push({ noteId: String(noteId), hash, sourcePath: sourcePath || "" });
        const attachmentFields = {
          id: attachment.id ?? null,
          filename: attachment.filename ?? null,
          mime: attachment.mime ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          isActive: attachment.isActive ?? null,
          dataHash: attachment.dataHash ?? null,
          dataSize: attachment.dataSize ?? null,
          parent_Note_id: attachment.parent_Note_id ?? null,
          sourceUrl: attachment.sourceUrl ?? attachment.sourceURL ?? attachment.source_url ?? null,
        };
        attachmentsOut.push({ attachmentFields, noteId, dataHash: hash, localFile: null });
        if (attachmentIndex === attachmentTotal || attachmentIndex % 10 === 0) {
          onProgress?.({
            stage: "resources",
            state: "running",
            current: attachmentIndex,
            total: attachmentTotal,
            message: "Copying Evernote resources...",
          });
        }
        continue;
      }
      const isActive = attachment.isActive;
      if (isActive === 0) {
        const attachmentFields = {
          id: attachment.id ?? null,
          filename: attachment.filename ?? null,
          mime: attachment.mime ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          isActive: attachment.isActive ?? null,
          dataHash: attachment.dataHash ?? null,
          dataSize: attachment.dataSize ?? null,
          parent_Note_id: attachment.parent_Note_id ?? null,
          sourceUrl: attachment.sourceUrl ?? attachment.sourceURL ?? attachment.source_url ?? null,
        };
        attachmentsOut.push({ attachmentFields, noteId, dataHash: hash, localFile: null });
        if (attachmentIndex === attachmentTotal || attachmentIndex % 10 === 0) {
          onProgress?.({
            stage: "resources",
            state: "running",
            current: attachmentIndex,
            total: attachmentTotal,
            message: "Copying Evernote resources...",
          });
        }
        continue;
      }
      try {
        await ensureDir(absPath.split("/").slice(0, -1).join("/"));
        await copyFile(sourcePath, absPath);
        assetMap.set(hash, relPath);
        const attachmentFields = {
          id: attachment.id ?? null,
          filename: attachment.filename ?? null,
          mime: attachment.mime ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          isActive: attachment.isActive ?? null,
          dataHash: attachment.dataHash ?? null,
          dataSize: attachment.dataSize ?? null,
          parent_Note_id: attachment.parent_Note_id ?? null,
          sourceUrl: attachment.sourceUrl ?? attachment.sourceURL ?? attachment.source_url ?? null,
        };
        attachmentsOut.push({
          attachmentFields,
          noteId,
          dataHash: hash,
          filename: attachment.filename || null,
          mime: attachment.mime || null,
          dataSize: attachment.dataSize || null,
          localFile: { relPath },
        });
      } catch (err) {
        assetCopyErrors.push({ sourcePath, destPath: absPath, error: String(err) });
        attachmentsOut.push({ attachmentFields: attachment, noteId, dataHash: hash, localFile: null });
      }
      if (attachmentIndex === attachmentTotal || attachmentIndex % 10 === 0) {
        onProgress?.({
          stage: "resources",
          state: "running",
          current: attachmentIndex,
          total: attachmentTotal,
          message: "Copying Evernote resources...",
        });
      }
    }
    onProgress?.({
      stage: "resources",
      state: "done",
      current: attachmentTotal,
      total: attachmentTotal,
      message: "Copying Evernote resources...",
    });

    const notesOut: any[] = [];
    const notesTotal = activeNotes.length;
    onProgress?.({ stage: "decode", state: "running", current: 0, total: notesTotal, message: "Decoding note content..." });
    let noteIndex = 0;
    for (const note of activeNotes) {
      noteIndex += 1;
      const noteId = String(note.id);
      try {
        const rte = await withTimeout(
          readRteDoc(summary.rteRoot, noteId),
          10000,
          `Decode timeout for note ${noteId}`
        );
        if (!rte.found) {
          missingRte.push({ id: noteId, path: rte.path });
        }
        if (rte.error) {
          decodeErrors.push({ id: noteId, path: rte.path, error: rte.error });
        }
        const enml = rte.enml ?? null;
        const enmlResolved = enml ? rewriteEnml(enml, assetMap) : null;
        const contentRaw = enmlResolved || enml || "";
        const contentNormalized = normalizeEnmlToHtml(contentRaw);
        const contentHash = await sha256Hex(contentNormalized);
        const contentSize = new TextEncoder().encode(contentNormalized).length;
        const createdAt = normalizeTimestamp(note.created ?? note.createdAt ?? note.creationDate, Math.floor(Date.now() / 1000));
        const updatedAt = normalizeTimestamp(note.updated ?? note.updatedAt ?? note.updateDate ?? createdAt, createdAt);
      notesOut.push({
        id: noteId,
        title: rte.title ?? note.title ?? note.label ?? "Untitled",
        notebookId: note.parent_Notebook_id ?? null,
        contentNormalized,
        contentHash,
        contentSize,
        createdAt,
        updatedAt,
      });
      } catch (err) {
        decodeErrors.push({ id: noteId, path: `${summary.rteRoot}/${noteId}`, error: String(err) });
      }
      if (noteIndex === notesTotal || noteIndex % 10 === 0) {
        onProgress?.({
          stage: "decode",
          state: "running",
          current: noteIndex,
          total: notesTotal,
          message: "Decoding note content...",
        });
      }
    }
    onProgress?.({
      stage: "decode",
      state: "done",
      current: notesTotal,
      total: notesTotal,
      message: "Decoding note content...",
    });
    onProgress?.({ stage: "database", state: "running", current: 0, total: 1, message: "Preparing import package..." });

    const exportData = {
      meta: {
        exportedAt: new Date().toISOString(),
        sourceRoot: summary.sourceRoot,
        noteCount: notesOut.length,
        notebookCount: notebooks.length,
        stackCount: summary.stackCount,
        attachmentCount: attachmentsOut.length,
        tagCount: tags.length,
        noteTagCount: noteTags.length,
        missingRteCount: missingRte.length,
        decodeErrorCount: decodeErrors.length,
      },
      stacks: Array.from(new Set(notebooks.map((nb: any) => normalizeStackId(nb.personal_Stack_id)).filter(Boolean))).map((id) => ({ id, name: id })),
      notebooks,
      tags,
      notes: notesOut,
      attachments: attachmentsOut,
      noteTags,
      missingRte,
      decodeErrors,
    };

    const jsonPath = `${importDir}/evernote_export.json`;
    await ensureDir(importDir);
    await saveBytesAs(jsonPath, Array.from(new TextEncoder().encode(JSON.stringify(exportData))));

    onProgress?.({ stage: "database", state: "running", current: 0, total: 1, message: "Writing notes database..." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stats = await importFromJson(jsonPath, assetsDir);
    try {
      await runNoteFilesBackfill();
    } catch (err) {
      errors.push(`Backfill failed: ${String(err)}`);
    }
    onProgress?.({
      stage: "database",
      state: "done",
      current: 1,
      total: 1,
      message: t("import.progress.database"),
    });

    const finishedAt = new Date().toISOString();
    const report: EvernoteImportReport = {
      startedAt,
      finishedAt,
      sourceRoot: summary.sourceRoot,
      targetDataDir: dataDir,
      backupDir,
      failed: false,
      summary,
      stats,
      missingRte,
      decodeErrors,
      missingResources,
      assetCopyErrors,
      errors,
    };

    await writeReport(report);
    return report;
  } catch (err) {
    onProgress?.({ stage: "database", state: "error", message: t("import.failed") });
    errors.push(String(err));
    const finishedAt = new Date().toISOString();
    const report: EvernoteImportReport = {
      startedAt,
      finishedAt,
      sourceRoot: summary.sourceRoot,
      targetDataDir: dataDir,
      backupDir,
      failed: true,
      summary,
      stats: { notes: 0, notebooks: 0, tags: 0, attachments: 0 },
      missingRte,
      decodeErrors,
      missingResources,
      assetCopyErrors,
      errors,
    };
    await writeReport(report);
    return report;
  }
};
