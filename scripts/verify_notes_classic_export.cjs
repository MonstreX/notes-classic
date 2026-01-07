#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/verify_notes_classic_export.js <export_root>");
  process.exit(2);
}

const manifestPath = path.join(root, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing manifest.json at ${manifestPath}`);
  process.exit(2);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const manifest = readJson(manifestPath);

const errors = [];
const noteById = new Map();
const fileById = new Map();

const safeArray = (v) => (Array.isArray(v) ? v : []);
const notes = safeArray(manifest.notes);
const noteTexts = safeArray(manifest.notes_text);
const attachments = safeArray(manifest.attachments);
const ocrFiles = safeArray(manifest.ocr_files);
const noteFiles = safeArray(manifest.note_files);

notes.forEach((note) => noteById.set(note.id, note));
ocrFiles.forEach((file) => fileById.set(file.id, file));

const checkExists = (p, label) => {
  if (!fs.existsSync(p)) {
    errors.push(`Missing ${label}: ${p}`);
  }
};

notes.forEach((note) => {
  if (!note.content_path || !note.meta_path) {
    errors.push(`Note ${note.id} missing content_path/meta_path`);
    return;
  }
  const htmlPath = path.join(root, note.content_path);
  const metaPath = path.join(root, note.meta_path);
  checkExists(htmlPath, "note content");
  checkExists(metaPath, "note meta");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (/notes-file:\/\//i.test(html) || /asset\.localhost/i.test(html)) {
      errors.push(`Note ${note.id} content contains non-portable asset URLs`);
    }
    const srcMatches = [...html.matchAll(/src=(["'])files\/([^"']+)\1/g)];
    srcMatches.forEach((match) => {
      const rel = match[2];
      const filePath = path.join(root, "files", rel);
      checkExists(filePath, `note ${note.id} file ${rel}`);
    });
  }
});

noteTexts.forEach((row) => {
  if (!noteById.has(row.note_id)) {
    errors.push(`notes_text references missing note_id ${row.note_id}`);
  }
});

attachments.forEach((att) => {
  if (att.export_path) {
    const exportPath = path.join(root, att.export_path.replace(/\//g, path.sep));
    checkExists(exportPath, `attachment ${att.id}`);
  }
});

ocrFiles.forEach((file) => {
  if (!file.export_path) {
    errors.push(`ocr_file ${file.id} missing export_path`);
    return;
  }
  const filePath = path.join(root, file.export_path.replace(/\//g, path.sep));
  checkExists(filePath, `ocr_file ${file.id}`);
});

noteFiles.forEach((link) => {
  if (!noteById.has(link.note_id)) {
    errors.push(`note_files references missing note_id ${link.note_id}`);
  }
  if (!fileById.has(link.file_id)) {
    errors.push(`note_files references missing file_id ${link.file_id}`);
  }
});

if (errors.length) {
  console.error("Export verification failed:");
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log("Export verification OK.");
