import fs from "fs";
import path from "path";
import process from "process";
import crypto from "crypto";
import initSqlJs from "sql.js";

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/evernote_import_temp.js --input <export_notes.json> --assets <export_assets> [--data <data_dir>]");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { input: null, assets: null, data: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--input") out.input = next;
    if (arg === "--assets") out.assets = next;
    if (arg === "--data") out.data = next;
  }
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeTimestamp(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num > 1e12) return Math.floor(num / 1000);
  if (num > 1e9) return Math.floor(num);
  return Math.floor(num);
}

function normalizeStackId(stackId) {
  if (!stackId) return null;
  if (stackId.startsWith("Stack:")) return stackId.slice("Stack:".length);
  return stackId;
}

function posixPath(value) {
  return value.split(path.sep).join("/");
}

function rewriteAssetPaths(html, fromBase, toBase) {
  if (!html) return html;
  let result = html;
  if (fromBase) {
    const escaped = fromBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(src=["'])${escaped}\/`, "g");
    result = result.replace(re, `$1${toBase}/`);
  }
  return result;
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getLastInsertId(db) {
  const res = db.exec("SELECT last_insert_rowid() AS id");
  return res[0]?.values?.[0]?.[0] ?? null;
}

function normalizeEnmlToHtml(enml) {
  if (!enml) return "";
  let html = enml;
  html = html.replace(/<en-note[^>]*>/gi, "<div>");
  html = html.replace(/<\/en-note>/gi, "</div>");
  html = html.replace(/<br><\/br>/gi, "<br>");
  html = html.replace(/<en-todo([^>]*)\/>/gi, (match, attrs) => {
    const checked = /checked=\"true\"/i.test(attrs);
    return `<input type="checkbox" ${checked ? "checked " : ""}disabled />`;
  });
  html = html.replace(/<div>/gi, "<p>");
  html = html.replace(/<\/div>/gi, "</p>");
  let prev = "";
  while (prev !== html) {
    prev = html;
    html = html.replace(/<p>\s*<p>/gi, "<p>");
    html = html.replace(/<\/p>\s*<\/p>/gi, "</p>");
  }
  return html;
}

async function main() {
  const args = parseArgs();
  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const assetsPath = args.assets ? path.resolve(process.cwd(), args.assets) : null;
  const dataDir = path.resolve(process.cwd(), args.data || "data");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const exportData = JSON.parse(raw);

  const wasmPath = path.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "notes.db");
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      parent_id INTEGER,
      notebook_type TEXT NOT NULL DEFAULT 'stack',
      sort_order INTEGER NOT NULL DEFAULT 0,
      external_id TEXT,
      FOREIGN KEY(parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_status INTEGER DEFAULT 0,
      remote_id TEXT,
      notebook_id INTEGER,
      external_id TEXT,
      meta TEXT,
      content_hash TEXT,
      content_size INTEGER,
      FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      external_id TEXT,
      FOREIGN KEY(parent_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_parent_name ON tags(parent_id, name);
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY(note_id, tag_id),
      FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      external_id TEXT,
      hash TEXT,
      filename TEXT,
      mime TEXT,
      size INTEGER,
      width INTEGER,
      height INTEGER,
      local_path TEXT,
      source_url TEXT,
      is_attachment INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id);
  `);

  db.run("BEGIN TRANSACTION");
  db.run("DELETE FROM note_tags");
  db.run("DELETE FROM attachments");
  db.run("DELETE FROM notes");
  db.run("DELETE FROM tags");
  db.run("DELETE FROM notebooks");
  db.run("DELETE FROM sqlite_sequence WHERE name IN ('note_tags','attachments','notes','tags','notebooks')");

  const now = Math.floor(Date.now() / 1000);
  const stacks = Array.isArray(exportData.stacks) ? exportData.stacks : [];
  const notebooks = Array.isArray(exportData.notebooks) ? exportData.notebooks : [];
  const notes = Array.isArray(exportData.notes) ? exportData.notes : [];
  const attachments = Array.isArray(exportData.attachments) ? exportData.attachments : [];
  const noteTags = Array.isArray(exportData.noteTags) ? exportData.noteTags : [];

  const stackIdMap = new Map();
  const notebookIdMap = new Map();
  const noteIdMap = new Map();

  const UNSORTED_STACK_ID = "__unsorted__";
  const stackOrder = 0;

  const insertNotebook = db.prepare("INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order, external_id) VALUES (?, ?, ?, ?, ?, ?)");

  let stackIndex = 0;
  for (const stack of stacks) {
    const name = stack.name || stack.id || "Stack";
    insertNotebook.run([name, now, null, "stack", stackIndex, `stack:${stack.id}`]);
    const localId = getLastInsertId(db);
    if (localId !== null) {
      stackIdMap.set(stack.id, localId);
    }
    stackIndex += 1;
  }

  const unsortedNeeded = notebooks.some((nb) => !normalizeStackId(nb.personal_Stack_id));
  if (unsortedNeeded) {
    insertNotebook.run(["Unsorted", now, null, "stack", stackIndex, `stack:${UNSORTED_STACK_ID}`]);
    const localId = getLastInsertId(db);
    if (localId !== null) {
      stackIdMap.set(UNSORTED_STACK_ID, localId);
    }
  }

  const notebookOrderMap = new Map();
  for (const nb of notebooks) {
    const stackId = normalizeStackId(nb.personal_Stack_id) || UNSORTED_STACK_ID;
    const parentId = stackIdMap.get(stackId) ?? null;
    const index = notebookOrderMap.get(stackId) ?? 0;
    const name = nb.label || nb.name || nb.title || nb.id;
    insertNotebook.run([name, now, parentId, "notebook", index, String(nb.id)]);
    const localId = getLastInsertId(db);
    if (localId !== null) {
      notebookIdMap.set(nb.id, localId);
    }
    notebookOrderMap.set(stackId, index + 1);
  }

  insertNotebook.free();

  const insertNote = db.prepare("INSERT INTO notes (title, content, created_at, updated_at, notebook_id, external_id, meta, content_hash, content_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const note of notes) {
    const fields = note.noteFields || {};
    const title = note.title || fields.title || fields.label || "Untitled";
    const createdAt = normalizeTimestamp(fields.created ?? fields.createdAt ?? fields.creationDate, now);
    const updatedAt = normalizeTimestamp(fields.updated ?? fields.updatedAt ?? fields.updateDate ?? createdAt, createdAt);
    const notebookExternalId = note.notebookId ?? fields.parent_Notebook_id ?? null;
    const notebookId = notebookIdMap.get(notebookExternalId) ?? null;
    const assetsBase = exportData?.meta?.assetsBase ? String(exportData.meta.assetsBase) : null;
    const contentRaw = note.enmlResolved || note.enml || "";
    const contentResolved = rewriteAssetPaths(contentRaw, assetsBase, "notes-file://files");
    const content = normalizeEnmlToHtml(contentResolved);
    const contentHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const contentSize = Buffer.byteLength(content, "utf8");
    const meta = {
      evernote: {
        noteFields: fields,
        customNoteStyles: note.customNoteStyles ?? null,
        rteMeta: note.meta ?? null,
        enml: note.enml ?? null,
        enmlResolved: note.enmlResolved ?? null,
        attachments: note.attachments ?? null,
      },
    };
    insertNote.run([
      title,
      content,
      createdAt,
      updatedAt,
      notebookId,
      String(note.id),
      JSON.stringify(meta),
      contentHash,
      contentSize,
    ]);
    const localNoteId = getLastInsertId(db);
    if (localNoteId !== null) {
      noteIdMap.set(note.id, localNoteId);
    }
  }
  insertNote.free();

  const insertAttachment = db.prepare("INSERT INTO attachments (note_id, external_id, hash, filename, mime, size, width, height, local_path, source_url, is_attachment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const attachment of attachments) {
    const fields = attachment.attachmentFields || {};
    const noteId = noteIdMap.get(attachment.noteId ?? fields.parent_Note_id) ?? null;
    if (!noteId) continue;
    const hash = attachment.dataHash || fields.dataHash || null;
    const filename = attachment.filename || fields.filename || null;
    const mime = attachment.mime || fields.mime || null;
    const size = attachment.dataSize || fields.dataSize || null;
    const width = fields.width ?? fields.imageWidth ?? null;
    const height = fields.height ?? fields.imageHeight ?? null;
    const relPath = attachment.localFile?.relPath
      ? posixPath(path.join("files", attachment.localFile.relPath))
      : null;
    const sourceUrl = fields.sourceUrl || fields.sourceURL || fields.source_url || null;
    const isAttachment = fields.isAttachment ?? fields.is_attachment ?? 1;
    const createdAt = normalizeTimestamp(fields.created ?? fields.createdAt, now);
    const updatedAt = normalizeTimestamp(fields.updated ?? fields.updatedAt, createdAt);

    insertAttachment.run([
      noteId,
      fields.id ? String(fields.id) : null,
      hash,
      filename,
      mime,
      size,
      width,
      height,
      relPath,
      sourceUrl,
      Number(isAttachment),
      createdAt,
      updatedAt,
    ]);
  }
  insertAttachment.free();

  if (Array.isArray(exportData.tags)) {
    const tagIdMap = new Map();
    const insertTag = db.prepare("INSERT INTO tags (name, parent_id, created_at, updated_at, external_id) VALUES (?, ?, ?, ?, ?)");

    const roots = exportData.tags.filter((t) => !t.parentId && !t.parent_Tag_id);
    for (const tag of roots) {
      const name = tag.name || tag.label || tag.id;
      insertTag.run([name, null, now, now, String(tag.id)]);
      const localId = getLastInsertId(db);
      if (localId !== null) tagIdMap.set(tag.id, localId);
    }

    const children = exportData.tags.filter((t) => t.parentId || t.parent_Tag_id);
    for (const tag of children) {
      const parentKey = tag.parentId || tag.parent_Tag_id;
      const parentId = tagIdMap.get(parentKey) ?? null;
      const name = tag.name || tag.label || tag.id;
      insertTag.run([name, parentId, now, now, String(tag.id)]);
      const localId = getLastInsertId(db);
      if (localId !== null) tagIdMap.set(tag.id, localId);
    }

    insertTag.free();

    const insertNoteTag = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)");
    for (const nt of noteTags) {
      const noteExternal = nt.note_id ?? nt.noteId ?? nt.Note_id;
      const tagExternal = nt.tag_id ?? nt.tagId ?? nt.Tag_id;
      const noteLocalId = noteIdMap.get(noteExternal);
      const tagLocalId = tagIdMap.get(tagExternal);
      if (!noteLocalId || !tagLocalId) continue;
      insertNoteTag.run([noteLocalId, tagLocalId]);
    }
    insertNoteTag.free();
  }

  db.run("COMMIT");

  const dbBuffer = db.export();
  fs.writeFileSync(dbPath, Buffer.from(dbBuffer));

  if (assetsPath && fs.existsSync(assetsPath)) {
    const filesDir = path.join(dataDir, "files");
    copyDirRecursive(assetsPath, filesDir);
  }

  console.log(`Imported notebooks: ${notebooks.length}`);
  console.log(`Imported notes: ${notes.length}`);
  console.log(`Imported attachments: ${attachments.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
