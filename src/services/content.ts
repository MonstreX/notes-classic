import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";

const imageSrcMap = new Map<string, string>();
const assetUrlCache = new Map<string, string>();
const ASSET_CACHE_LIMIT = 2000;
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

export const normalizeFileLinks = (raw: string) => {
  if (!raw) return raw;
  return raw
    .replace(/src=\"notes-file:\/\/files\//g, 'src="files/')
    .replace(/src='notes-file:\/\/files\//g, "src='files/");
};

const pruneAssetCache = () => {
  while (assetUrlCache.size > ASSET_CACHE_LIMIT) {
    const oldestRel = assetUrlCache.keys().next().value;
    if (!oldestRel) break;
    const assetUrl = assetUrlCache.get(oldestRel);
    assetUrlCache.delete(oldestRel);
    if (assetUrl) {
      imageSrcMap.delete(assetUrl);
    }
  }
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
  imageSrcMap.set(assetUrl, `files/${relPath}`);
  pruneAssetCache();
  return assetUrl;
};

const extractRelFromAssetUrl = (url: string) => {
  try {
    const decoded = decodeURIComponent(url);
    const marker = "/files/";
    const idx = decoded.toLowerCase().indexOf(marker);
    if (idx >= 0) {
      return decoded.slice(idx + marker.length);
    }
  } catch (e) {
    // ignore decode errors
  }
  const encoded = url.toLowerCase();
  const marker = "%2ffiles%2f";
  const idx = encoded.indexOf(marker);
  if (idx >= 0) {
    const relEncoded = url.slice(idx + marker.length);
    try {
      return decodeURIComponent(relEncoded);
    } catch (e) {
      return relEncoded;
    }
  }
  return null;
};

export const toAssetUrl = async (relPath: string) => {
  const normalized = relPath.replace(/^files\//i, "");
  return buildAssetUrl(normalized);
};

export const toDisplayContent = async (raw: string) => {
  if (!raw) return raw;
  const normalized = normalizeFileLinks(raw);
  const matches = Array.from(normalized.matchAll(/src=(\"|')files\/(?:evernote\/)?([^\"']+)\1/g));
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

  return normalized.replace(/src=(\"|')files\/(?:evernote\/)?([^\"']+)\1/g, (match, quote, rel) => {
    const assetUrl = resolved.get(rel);
    if (!assetUrl) return match;
    return `src=${quote}${assetUrl}${quote}`;
  });
};

export const toStorageContent = (raw: string) => {
  if (!raw) return raw;
  const normalized = raw.replace(/src=(\"|')notes-file:\/\/files\//g, `src=$1files/`);
  const restored = normalized.replace(/src=(\"|')((?:https?:\/\/asset\.localhost\/|asset:\/\/|tauri:\/\/)[^\"']+)\1/g, (match, quote, url) => {
    const original = imageSrcMap.get(url);
    if (original) {
      return `src=${quote}${original}${quote}`;
    }
    const rel = extractRelFromAssetUrl(url);
    if (!rel) return match;
    return `src=${quote}files/${rel}${quote}`;
  });
  return restored.replace(/src=(\"|')(data:[^\"']+)\1/g, (match, quote, dataUrl) => {
    const original = imageSrcMap.get(dataUrl);
    if (!original) return match;
    return `src=${quote}${original}${quote}`;
  });
};
