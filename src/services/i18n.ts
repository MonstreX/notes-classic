import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type LanguageCode = "en" | "ru";

const SUPPORTED_LANGS: LanguageCode[] = ["en", "ru"];
const FALLBACK_LANG: LanguageCode = "en";

let currentLang: LanguageCode = FALLBACK_LANG;
let messages: Record<string, string> = {};
let fallbackMessages: Record<string, string> = {};
let resourceDirPromise: Promise<string> | null = null;
let i18nDirPromise: Promise<string> | null = null;
let pluralRules: Intl.PluralRules | null = null;

const getResourceDir = async () => {
  if (!resourceDirPromise) {
    resourceDirPromise = invoke<string>("get_resource_dir");
  }
  return resourceDirPromise;
};

const getI18nDir = async () => {
  if (!i18nDirPromise) {
    i18nDirPromise = invoke<string>("get_i18n_dir").catch(async () => {
      const base = await getResourceDir();
      return base ? `${base}/i18n` : "";
    });
  }
  return i18nDirPromise;
};

const stripExtendedPrefix = (value: string) => {
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  if (value.startsWith("//?/")) return value.slice(4);
  return value;
};

const normalizeBasePath = (base: string) => {
  const cleaned = stripExtendedPrefix(base).replace(/[\\/]+$/, "");
  return cleaned;
};

const buildUrlPath = (base: string, lang: string) => {
  const cleaned = normalizeBasePath(base).replace(/\\/g, "/");
  return `${cleaned}/${lang}.json`;
};

const buildFsPath = (base: string, lang: string) => {
  const cleaned = normalizeBasePath(base);
  if (cleaned.includes("\\") || /^[A-Za-z]:\\/.test(cleaned)) {
    return `${cleaned}\\${lang}.json`;
  }
  return `${cleaned}/${lang}.json`;
};

const decodeJson = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

const loadMessages = async (lang: LanguageCode) => {
  try {
    const base = await getI18nDir();
    if (!base) {
      console.warn("[i18n] empty i18n dir");
      return {};
    }
    const urlPath = buildUrlPath(base, lang);
    const url = convertFileSrc(urlPath);
    const response = await fetch(url);
    if (response.ok) {
      return (await response.json()) as Record<string, string>;
    }
    console.warn("[i18n] fetch failed", { lang, url, status: response.status });
  } catch (err) {
    console.warn("[i18n] fetch error", err);
  }
  try {
    const base = await getI18nDir();
    if (!base) {
      console.warn("[i18n] empty i18n dir for read");
      return {};
    }
    const path = buildFsPath(base, lang);
    const bytes = await invoke<number[]>("read_file_bytes", { path });
    const text = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    return decodeJson(text);
  } catch (err) {
    console.warn("[i18n] read_file_bytes failed", err);
    return {};
  }
};

export const isSupportedLanguage = (value: string | null | undefined): value is LanguageCode => {
  if (!value) return false;
  return SUPPORTED_LANGS.includes(value as LanguageCode);
};

export const detectSystemLanguage = (): LanguageCode => {
  const raw = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
  const code = raw.split("-")[0];
  return isSupportedLanguage(code) ? code : FALLBACK_LANG;
};

export const initI18n = async (lang: LanguageCode) => {
  fallbackMessages = await loadMessages(FALLBACK_LANG);
  const current = lang === FALLBACK_LANG ? fallbackMessages : await loadMessages(lang);
  messages = Object.keys(current).length > 0 ? current : fallbackMessages;
  currentLang = lang;
  pluralRules = new Intl.PluralRules(currentLang);
};

export const getCurrentLanguage = () => currentLang;

export const t = (key: string, vars?: Record<string, string | number>) => {
  const template = messages[key] ?? fallbackMessages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = vars[token];
    return value === undefined ? match : String(value);
  });
};

export const tCount = (baseKey: string, count: number, vars?: Record<string, string | number>) => {
  const rules = pluralRules ?? new Intl.PluralRules(currentLang);
  const category = rules.select(count);
  const key = `${baseKey}.${category}`;
  return t(key, { count, ...vars });
};

export const listLanguages = (): Array<{ value: LanguageCode; label: string }> => [
  { value: "en", label: t("language.en") },
  { value: "ru", label: t("language.ru") },
];
