import fs from "fs";
import path from "path";
import process from "process";
import initSqlJs from "sql.js";
import * as Y from "yjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/evernote_export.js --db <RemoteGraph.sql> --rte <internal_rteDoc> --out <file.json> [--limit N]");
  console.log("  node scripts/evernote_export.js --db <RemoteGraph.sql> --rte <internal_rteDoc> --out <file.json> --resources <resource-cache> --assets <assets-dir>");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { db: null, rte: null, out: null, limit: null, resources: null, assets: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--db") out.db = next;
    if (arg === "--rte") out.rte = next;
    if (arg === "--out") out.out = next;
    if (arg === "--limit") out.limit = Number(next);
    if (arg === "--resources") out.resources = next;
    if (arg === "--assets") out.assets = next;
  }
  return out;
}

function toRowObjects(stmt) {
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  return rows;
}

function listTables(db) {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
  const rows = toRowObjects(stmt);
  stmt.free();
  return rows.map((r) => r.name);
}

function selectAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = toRowObjects(stmt);
  stmt.free();
  return rows;
}

function readRteDoc(rteRoot, noteId) {
  const subA = noteId.slice(0, 3);
  const subB = noteId.slice(-3);
  const filePath = path.join(rteRoot, subA, subB, `${noteId}.dat`);
  if (!fs.existsSync(filePath)) {
    return { found: false, path: filePath };
  }
  const update = fs.readFileSync(filePath);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
  } catch (err) {
    return { found: true, path: filePath, error: String(err) };
  }
  const content = doc.getXmlFragment("content").toString();
  const title = doc.getText("title").toString();
  const customNoteStyles = doc.getMap("customNoteStyles").toJSON();
  const meta = doc.getMap("meta").toJSON();
  return { found: true, path: filePath, title, enml: content, customNoteStyles, meta };
}

function normalizeStackId(stackId) {
  if (!stackId) return null;
  if (stackId.startsWith("Stack:")) return stackId.slice("Stack:".length);
  return stackId;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeExt(ext) {
  if (!ext) return null;
  const clean = ext.replace(/[^a-zA-Z0-9.]/g, "");
  return clean.startsWith(".") ? clean.slice(1).toLowerCase() : clean.toLowerCase();
}

function extFromMime(mime) {
  if (!mime) return null;
  const map = {
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
}

function buildAssetPath(assetsRoot, hash, ext) {
  const prefix = hash.slice(0, 2);
  const fileName = ext ? `${hash}.${ext}` : hash;
  const relPath = path.join(prefix, fileName);
  const absPath = path.join(assetsRoot, prefix, fileName);
  return { relPath, absPath };
}

function copyResourceFile(resourcesRoots, assetsRoot, noteId, attachment) {
  if (!resourcesRoots || resourcesRoots.length === 0 || !assetsRoot) return null;
  const hash = attachment.dataHash;
  if (!hash || !noteId) return null;
  let sourcePath = null;
  for (const root of resourcesRoots) {
    const candidate = path.join(root, noteId, hash);
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }
  if (!sourcePath) {
    const fallback = path.join(resourcesRoots[0], noteId, hash);
    return { sourcePath: fallback, exists: false };
  }

  const extFromName = sanitizeExt(path.extname(attachment.filename || ""));
  const ext = extFromName || extFromMime(attachment.mime || "");
  const { relPath, absPath } = buildAssetPath(assetsRoot, hash, ext);
  ensureDir(path.dirname(absPath));
  fs.copyFileSync(sourcePath, absPath);

  return { sourcePath, exists: true, relPath, absPath };
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function resolveResourcesRoots(resourcesRoot) {
  if (!resourcesRoot) return null;
  if (!fs.existsSync(resourcesRoot)) return [resourcesRoot];
  const entries = fs.readdirSync(resourcesRoot, { withFileTypes: true });
  const userDirs = entries.filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("user"));
  if (userDirs.length > 0) {
    return userDirs.map((entry) => path.join(resourcesRoot, entry.name));
  }
  return [resourcesRoot];
}

function rewriteEnml(enml, assetMap, assetsBase) {
  if (!enml) return enml;
  return enml.replace(/<en-media[^>]*?hash=\"([0-9a-f]+)\"[^>]*?(?:><\/en-media>|\\s*\/>)/gi, (match, hash) => {
    const rel = assetMap.get(hash);
    if (!rel) return match;
    const src = assetsBase ? `${assetsBase}/${rel}` : rel;
    return `<img data-en-hash="${hash}" src="${src}" />`;
  });
}

async function main() {
  const args = parseArgs();
  if (!args.db || !args.rte || !args.out) {
    printUsage();
    process.exit(1);
  }
  if ((args.assets && !args.resources) || (!args.assets && args.resources)) {
    console.error("Both --resources and --assets must be provided together.");
    process.exit(1);
  }

  const resourcesRoots = resolveResourcesRoots(args.resources);

  const wasmPath = path.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const dbBuffer = fs.readFileSync(args.db);
  const db = new SQL.Database(dbBuffer);

  const tables = listTables(db);
  if (!tables.includes("Nodes_Note") || !tables.includes("Nodes_Notebook")) {
    console.error("Required tables not found. Expected Nodes_Note and Nodes_Notebook.");
    process.exit(1);
  }

  const notebooks = selectAll(db, "SELECT * FROM Nodes_Notebook");
  const notes = selectAll(db, args.limit ? "SELECT * FROM Nodes_Note LIMIT ?" : "SELECT * FROM Nodes_Note", args.limit ? [args.limit] : []);

  const stacksMap = new Map();
  for (const nb of notebooks) {
    const stackId = normalizeStackId(nb.personal_Stack_id);
    if (stackId) stacksMap.set(stackId, { id: stackId, name: stackId });
  }

  const noteTagTable = tables.includes("NoteTag") ? selectAll(db, "SELECT * FROM NoteTag") : [];
  const tagTable = tables.includes("Nodes_Tag") ? selectAll(db, "SELECT * FROM Nodes_Tag") : [];
  const attachmentTable = tables.includes("Attachment") ? selectAll(db, "SELECT * FROM Attachment") : [];

  const missingRte = [];
  const decodeErrors = [];
  const notesOut = [];
  const attachmentsOut = [];
  const assetMap = new Map();
  const assetsBase = args.assets ? toPosixPath(path.relative(path.dirname(args.out), args.assets)) : null;

  for (const note of notes) {
    const noteId = note.id;
    const rte = readRteDoc(args.rte, noteId);
    if (!rte.found) {
      missingRte.push({ id: noteId, path: rte.path });
    }
    if (rte.error) {
      decodeErrors.push({ id: noteId, path: rte.path, error: rte.error });
    }
    notesOut.push({
      id: noteId,
      title: rte.title ?? null,
      enml: rte.enml ?? null,
      customNoteStyles: rte.customNoteStyles ?? null,
      meta: rte.meta ?? null,
      noteFields: note,
      notebookId: note.parent_Notebook_id ?? null,
    });
  }

  for (const attachment of attachmentTable) {
    const noteId = attachment.parent_Note_id || null;
    const copied = copyResourceFile(resourcesRoots, args.assets, noteId, attachment);
    if (copied?.relPath && attachment.dataHash) {
      assetMap.set(attachment.dataHash, toPosixPath(copied.relPath));
    }
    attachmentsOut.push({
      attachmentFields: attachment,
      noteId,
      dataHash: attachment.dataHash || null,
      filename: attachment.filename || null,
      mime: attachment.mime || null,
      dataSize: attachment.dataSize || null,
      localFile: copied
        ? {
            exists: copied.exists,
            sourcePath: copied.sourcePath,
            relPath: copied.relPath ?? null,
            absPath: copied.absPath ?? null,
          }
        : null,
    });
  }

  const notesResolved = notesOut.map((note) => {
    const enmlResolved = rewriteEnml(note.enml, assetMap, assetsBase);
    const noteAttachments = attachmentsOut
      .filter((att) => att.noteId === note.id)
      .map((att) => ({
        dataHash: att.dataHash,
        filename: att.filename,
        mime: att.mime,
        dataSize: att.dataSize,
        relPath: att.localFile?.relPath ? toPosixPath(att.localFile.relPath) : null,
      }));
    return { ...note, enmlResolved, attachments: noteAttachments };
  });

  const exportData = {
    meta: {
      exportedAt: new Date().toISOString(),
      dbPath: args.db,
      rteRoot: args.rte,
      resourcesRoot: resourcesRoots ? resourcesRoots.join(";") : null,
      assetsDir: args.assets,
      assetsBase,
      noteCount: notesOut.length,
      notebookCount: notebooks.length,
      stackCount: stacksMap.size,
      attachmentCount: attachmentsOut.length,
      tagCount: tagTable.length,
      noteTagCount: noteTagTable.length,
      missingRteCount: missingRte.length,
      decodeErrorCount: decodeErrors.length,
    },
    stacks: Array.from(stacksMap.values()),
    notebooks,
    tags: tagTable,
    notes: notesResolved,
    attachments: attachmentsOut,
    noteTags: noteTagTable,
    missingRte,
    decodeErrors,
  };

  fs.writeFileSync(args.out, JSON.stringify(exportData, null, 2));
  console.log(`Exported: ${args.out}`);
  if (missingRte.length) {
    console.warn(`Missing RTE: ${missingRte.length}`);
  }
  if (decodeErrors.length) {
    console.warn(`Decode errors: ${decodeErrors.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
