#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/verify_import_examples.js <examples_root>");
  process.exit(2);
}

const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

const errors = [];
const warn = [];

const readUtf8 = (p) => fs.readFileSync(p, "utf8");
const hasBom = (p) => {
  const buf = fs.readFileSync(p);
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
};

const listFiles = (dir) => {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
};

const checkNoBom = (file) => {
  if (hasBom(file)) {
    errors.push(`BOM detected: ${file}`);
  }
};

const normalizeRel = (value) => {
  const cleaned = value.replace(/\\/g, "/");
  const parts = [];
  cleaned.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.join("/");
};

const stripAlias = (value) => {
  const cleaned = value.split("|")[0] || value;
  return cleaned.split("#")[0].trim();
};

const checkMarkdownLinks = (file, baseDir, fileIndex) => {
  const raw = readUtf8(file);
  const regex = /!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|(attachments\/[^\s)\]]+)|(images\/[^\s)\]]+)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const rawTarget = (match[1] || match[2] || match[3] || match[4] || "").trim();
    if (!rawTarget || /^https?:\/\//i.test(rawTarget)) continue;
    const cleaned = stripAlias(rawTarget).replace(/\]\]+$/u, "").replace(/[),.;]+$/u, "");
    const lower = cleaned.toLowerCase();
    const isAsset =
      lower.startsWith("attachments/") ||
      lower.startsWith("images/") ||
      /\.(png|jpe?g|gif|webp|bmp|svg|jfif|tif|tiff|pdf|txt|zip|rar|7z)$/i.test(lower);
    if (!isAsset) continue;
    const normalized = normalizeRel(cleaned.replace(/^\.?[\\/]+/u, ""));
    if (fileIndex.has(normalized)) continue;
    const candidate = path.join(baseDir, normalized);
    if (isFile(candidate)) continue;
    errors.push(`Missing referenced asset: ${cleaned} in ${file}`);
  }
};

const checkHtmlLinks = (file, baseDir, fileIndex) => {
  const raw = readUtf8(file);
  const srcRegex = /src=(["'])([^"']+)\1/gi;
  let match;
  while ((match = srcRegex.exec(raw)) !== null) {
    const src = match[2];
    if (/^https?:\/\//i.test(src)) continue;
    if (/notes-file:\/\//i.test(src) || /asset\.localhost/i.test(src)) {
      errors.push(`Non-portable asset URL in ${file}: ${src}`);
      continue;
    }
    const normalized = normalizeRel(src.replace(/^\.?[\\/]+/u, ""));
    if (fileIndex.has(normalized)) continue;
    const candidate = path.join(baseDir, normalized);
    if (isFile(candidate)) continue;
    errors.push(`Missing referenced asset: ${src} in ${file}`);
  }
};

const checkTextLinks = (file, baseDir, fileIndex) => {
  const raw = readUtf8(file);
  const regex = /(attachments\/[^\s)]+)|(images\/[^\s)]+)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const target = (match[1] || match[2] || "").trim();
    if (!target) continue;
    const cleaned = target.replace(/\]\]+$/u, "").replace(/[),.;]+$/u, "");
    const normalized = normalizeRel(cleaned.replace(/^\.?[\\/]+/u, ""));
    if (fileIndex.has(normalized)) continue;
    const candidate = path.join(baseDir, normalized);
    if (isFile(candidate)) continue;
    errors.push(`Missing referenced asset: ${cleaned} in ${file}`);
  }
};

const checkExample = (name, dir) => {
  if (!isDir(dir)) {
    warn.push(`Missing example folder: ${dir}`);
    return;
  }
  const files = listFiles(dir);
  const fileIndex = new Map();
  files.forEach((file) => {
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    fileIndex.set(rel, file);
    if (/\.(md|txt|html)$/i.test(file)) {
      checkNoBom(file);
    }
  });

  const notes = files.filter((file) => /\.(md|txt|html)$/i.test(file));
  notes.forEach((file) => {
    if (file.toLowerCase().endsWith(".md")) {
      checkMarkdownLinks(file, dir, fileIndex);
    } else if (file.toLowerCase().endsWith(".html")) {
      checkHtmlLinks(file, dir, fileIndex);
    } else if (file.toLowerCase().endsWith(".txt")) {
      checkTextLinks(file, dir, fileIndex);
    }
  });
};

checkExample("obsidian", path.join(root, "obsidian"));
checkExample("html", path.join(root, "html"));
checkExample("text", path.join(root, "text"));

if (warn.length) {
  console.warn("Warnings:");
  warn.forEach((item) => console.warn(`- ${item}`));
}

if (errors.length) {
  console.error("Import example verification failed:");
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log("Import examples verification OK.");
