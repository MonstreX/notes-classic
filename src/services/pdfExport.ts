import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { getNote } from "./notes";
import { logError } from "./logger";
import { extractRelFromSrc, getDataDir, saveBytesAs, sanitizeFilename } from "./exportUtils";
import { join } from "@tauri-apps/api/path";

const stripSelectionMarkers = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("[data-jodit-selection_marker], [data-jodit-temp]").forEach((el) => el.remove());
  doc.body.querySelectorAll("span").forEach((el) => {
    if (!el.textContent?.trim() && el.attributes.length === 0) {
      el.remove();
    }
  });
  return doc.body.innerHTML.replace(/\uFEFF/g, "");
};

const buildAssetUrl = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  return `http://asset.localhost/${encodeURIComponent(normalized)}`;
};

const loadImageBlob = async (src: string, dataDir: string) => {
  if (src.startsWith("data:")) {
    const response = await fetch(src);
    if (!response.ok) throw new Error("image fetch failed");
    return await response.blob();
  }
  const relFromSrc =
    src.startsWith("notes-file://")
      ? src.replace("notes-file://", "").replace(/^files[\\/]/i, "")
      : extractRelFromSrc(src);
  if (relFromSrc) {
    const fullPath = await join(dataDir, "files", relFromSrc);
    const assetUrl = buildAssetUrl(fullPath);
    const response = await fetch(assetUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("image fetch failed");
    return await response.blob();
  }
  const response = await fetch(src, { cache: "no-store" });
  if (!response.ok) throw new Error("image fetch failed");
  return await response.blob();
};

const prepareImages = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll("img"));
  if (!images.length) return;
  const dataDir = await getDataDir();
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;
      try {
        const blob = await loadImageBlob(src, dataDir);
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("image read failed"));
          reader.readAsDataURL(blob);
        });
        if (dataUrl) {
          img.setAttribute("src", dataUrl);
        }
      } catch {
        // keep original src
      }
    })
  );
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
};

const buildPdfContainer = (title: string, content: string) => {
  const container = document.createElement("div");
  container.className = "pdf-export";
  container.style.position = "absolute";
  container.style.left = "0";
  container.style.top = "0";
  container.style.transform = "translateX(-200vw)";
  container.style.pointerEvents = "none";
  container.style.zIndex = "9999";
  container.style.width = "794px";
  container.style.background = "#ffffff";
  container.style.display = "block";
  container.style.height = "auto";
  container.style.maxHeight = "none";
  container.style.overflow = "visible";
  container.style.color = "#111827";
  container.style.fontSize = "16px";
  container.style.lineHeight = "1.6";
  container.innerHTML = `
    <style>
      .pdf-export h1 { font-size: 22px; font-weight: 500; margin: 0 0 16px; }
      .pdf-export p { margin: 0 0 0.9em; }
      .pdf-export h2, .pdf-export h3, .pdf-export h4, .pdf-export h5, .pdf-export h6 { margin: 1em 0 0.6em; font-weight: 600; }
      .pdf-export ul, .pdf-export ol { margin: 0 0 1em 1.5em; padding: 0; }
      .pdf-export li { margin: 0.25em 0; }
      .pdf-export hr { border: none; border-top: 1px solid #d3d3d3; margin: 1.2em 0; }
      .pdf-export a { color: #0b6ee0; text-decoration: underline; }
      .pdf-export img { max-width: 100%; height: auto; }
      .pdf-export table { border-collapse: collapse; margin: 0 0 1em; }
      .pdf-export th, .pdf-export td { border: 1px solid #e5e7eb; padding: 6px 8px; }
      .pdf-export pre { white-space: pre-wrap; word-break: break-word; }
      .pdf-export code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
      .pdf-export .note-callout { background: #f3f3f3; border-radius: 4px; padding: 10px 15px; margin: 0 0 1em; font-size: 13px; line-height: 1.2; }
      .pdf-export .note-code { position: relative; background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 12px 8px; margin: 0 0 1em; font-family: Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.4; }
      .pdf-export .note-attachment { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 4px; border: 1px solid #e5e7eb; background: #f9fafb; color: #374151; font-size: 12px; margin: 0 0 1em; }
      .pdf-export .note-attachment__actions { display: none; }
      .pdf-export .note-secure { display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 4px; border: 1px solid #e5e7eb; background: #f3f4f6; color: #6b7280; font-size: 12px; }
    </style>
    <div class="pdf-content" style="max-width: 794px; margin: 0 auto; padding: 24px 28px;">
      <h1>${title}</h1>
      ${content}
    </div>
  `;
  document.body.appendChild(container);
  return container;
};

export const exportNotePdf = async (noteId: number, title: string) => {
  const suggestedName = sanitizeFilename(title?.trim() || "Note");
  try {
    const note = await getNote(noteId);
    if (!note) return;
    const destPath = await save({
      defaultPath: `${suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destPath) return;
    const cleanContent = stripSelectionMarkers(note.content || "");
    const container = buildPdfContainer(note.title || suggestedName, cleanContent);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await prepareImages(container);
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.98);
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        pdf.addPage();
        position = position - pageHeight;
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      const buffer = pdf.output("arraybuffer");
      const bytes = new Uint8Array(buffer);
      if (bytes.length === 0) {
        throw new Error("PDF is empty");
      }
      const finalPath = destPath.toLowerCase().endsWith(".pdf") ? destPath : `${destPath}.pdf`;
      await saveBytesAs(finalPath, bytes);
    } finally {
      container.remove();
    }
  } catch (error) {
    logError("[export] pdf failed", error);
  }
};
