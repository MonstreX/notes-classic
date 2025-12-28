import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";

const imageSrcMap = new Map<string, string>();
const assetUrlCache = new Map<string, string>();
let dataDirPromise: Promise<string> | null = null;

const getDataDir = async () => {
  if (!dataDirPromise) {
    dataDirPromise = invoke<string>("get_data_dir");
  }
  return dataDirPromise;
};

export const normalizeEnmlContent = (raw: string) => {
  if (!raw) return raw;
  let out = raw.replace(/<en-note[^>]*>/gi, "<div>");
  out = out.replace(/<\/en-note>/gi, "</div>");
  out = out.replace(/<br><\/br>/gi, "<br>");
  return out;
};

export const ensureNotesScheme = (raw: string) => {
  if (!raw) return raw;
  if (raw.includes("notes-file://")) return raw;
  return raw
    .replace(/src=\"files\//g, 'src="notes-file://files/')
    .replace(/src='files\//g, "src='notes-file://files/");
};

const buildAssetUrl = async (relPath: string) => {
  const cached = assetUrlCache.get(relPath);
  if (cached) return cached;
  const dataDir = await getDataDir();
  const normalizedDir = dataDir.replace(/\\/g, "/");
  const normalizedRel = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const fullPath = `${normalizedDir}/files/${normalizedRel}`;
  const assetUrl = convertFileSrc(fullPath);
  assetUrlCache.set(relPath, assetUrl);
  imageSrcMap.set(assetUrl, `notes-file://files/${relPath}`);
  return assetUrl;
};

export const toDisplayContent = async (raw: string) => {
  if (!raw) return raw;
  const normalized = ensureNotesScheme(raw);
  const matches = Array.from(normalized.matchAll(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g));
  if (matches.length === 0) return normalized;

  const uniqueRel = Array.from(new Set(matches.map((m) => m[2])));
  const resolved = new Map<string, string>();
  await Promise.all(
    uniqueRel.map(async (rel) => {
      try {
        const assetUrl = await buildAssetUrl(rel);
        resolved.set(rel, assetUrl);
      } catch (e) {
        logError("[content] asset url failed", e);
      }
    })
  );

  return normalized.replace(/src=(\"|')notes-file:\/\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, rel) => {
    const assetUrl = resolved.get(rel);
    if (!assetUrl) return match;
    return `src=${quote}${assetUrl}${quote}`;
  });
};

export const toStorageContent = (raw: string) => {
  if (!raw) return raw;
  const normalized = raw.replace(/src=(\"|')(asset|tauri):\/\/[^\"']*?\/files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, _scheme, rel) => {
    return `src=${quote}notes-file://files/${rel}${quote}`;
  });
  const restored = normalized.replace(/src=(\"|')((?:https?:\/\/asset\.localhost\/|asset:\/\/)[^\"']+)\1/g, (match, quote, url) => {
    const original = imageSrcMap.get(url);
    if (!original) return match;
    return `src=${quote}${original}${quote}`;
  });
  return restored.replace(/src=(\"|')(data:[^\"']+)\1/g, (match, quote, dataUrl) => {
    const original = imageSrcMap.get(dataUrl);
    if (!original) return match;
    return `src=${quote}${original}${quote}`;
  });
};
