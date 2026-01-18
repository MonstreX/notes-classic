export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const escapeAttr = (value: string) =>
  escapeHtml(value).replace(/"/g, "&quot;");

export const normalizeKey = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();

export const fallbackHtmlFromText = (raw: string) => {
  const safe = escapeHtml(raw).replace(/\n/g, "<br>");
  return `<p>${safe}</p>`;
};

export const isLikelyEncoded = (raw: string) => {
  const sample = raw.slice(0, 120000);
  let totalChars = 0;
  let base64Chars = 0;
  let longestBase64Run = 0;
  let currentRun = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const ch = sample[i];
    if (ch.trim()) {
      totalChars += 1;
    }
    if (/[A-Za-z0-9+/=]/.test(ch)) {
      base64Chars += 1;
      currentRun += 1;
      if (currentRun > longestBase64Run) longestBase64Run = currentRun;
    } else if (ch === "\n" || ch === "\r" || ch === " " || ch === "\t") {
      currentRun = 0;
    } else {
      currentRun = 0;
    }
  }
  if (totalChars < 20000) return false;
  const ratio = base64Chars / totalChars;
  return longestBase64Run >= 5000 && ratio >= 0.97;
};

export const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};
