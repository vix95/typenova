/** HTML export and printing of the rendered document. */
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { normalizeLocalImagePath, basename } from "../filesystem/path-utils";
import { save } from "@tauri-apps/plugin-dialog";
import { $ } from "../app/dom";
import { printArea } from "../app/workspace-dom";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { resolveLocalImages } from "./code-blocks";
import { appAlert } from "../ui/dialogs";
import { showToast } from "../ui/toast";

async function renderFullDocument(): Promise<string> {
  const worker = new Worker(new URL("../preview.worker.ts", import.meta.url), { type: "module" });
  const text = view.state.doc.toString();
  return await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error("Przekroczono czas renderowania dokumentu.")); }, 120000);
    worker.addEventListener("message", (event: MessageEvent) => { if (event.data.action !== "all") return; clearTimeout(timer); worker.terminate(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.html as string); }, { once: true });
    worker.addEventListener("error", (event: ErrorEvent) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); }, { once: true });
    worker.postMessage({ id: 1, action: "all", text, revision: documentState.docRevision, mode: documentMode(), language: document.documentElement.lang === "en" ? "en" : "pl" });
  });
}
function mimeForImage(path: string) { const name = path.split(/[\/\\]/).pop() || path; const ext = name.split(".").pop()?.toLowerCase(); return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff" } as Record<string, string>)[ext || ""] || "application/octet-stream"; }
function bytesToBase64(bytes: Uint8Array) { let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk)binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary); }
async function inlineLocalImages(html: string) {
  const template = document.createElement("template"); template.innerHTML = html;
  const images = Array.from(template.content.querySelectorAll<HTMLImageElement>("img"));
  const base = documentState.currentPath ? documentState.currentPath.replace(/[\\/][^\\/]*$/, "") : null;
  await Promise.all(images.map(async img => {
    const src = img.getAttribute("src") || "";
    if (!src || /^(https?:|data:|blob:|#)/i.test(src)) return;
    if (!base) { img.dataset.exportWarning = "no-document-path"; return; }
    try {
      const rawPath = src.replace(/^file:\/\//, "").split(/[?#]/, 1)[0];
      const clean = decodeURIComponent(rawPath);
      const path = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(clean) ? clean : `${base}/${clean.replace(/^\.\//, "")}`;
      const bytes = await readFile(normalizeLocalImagePath(path));
      img.setAttribute("src", `data:${mimeForImage(path)};base64,${bytesToBase64(bytes)}`);
    } catch (error) { console.warn("Nie udało się osadzić obrazu w eksporcie:", src, error); img.dataset.exportWarning = "image-not-embedded"; }
  }));
  return template.innerHTML;
}
export async function exportHtml() {
  try {
    $("statusText").textContent = langText("Przygotowywanie eksportu…", "Preparing export…");
    const rawContent = await renderFullDocument();
    const content = await inlineLocalImages(rawContent);
    const title = documentState.currentPath ? basename(documentState.currentPath).replace(/\.(md|ipynb)$/i, "") : "TypeNova";
    const safeTitle = title.replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#202533}pre{overflow:auto;padding:16px;background:#f1f3f7;border-radius:8px}code{font-family:Consolas,monospace}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}img{max-width:100%;height:auto}a{color:#0645ad}.notebook-cell{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;margin:0 0 16px}.notebook-cell-prompt{text-align:right;color:#64748b;font:11px Consolas,monospace;padding-top:14px}.notebook-cell-panel{border:1px solid #cbd5e1;border-radius:9px;overflow:hidden;min-width:0}.notebook-cell-toolbar{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font-size:11px;color:#64748b}.notebook-code{margin:0!important;padding:13px 15px!important;background:#f8fafc!important;color:#172033!important;overflow:auto}.notebook-code code{font:12px/1.6 Consolas,monospace}.notebook-language-pill{display:inline-block;border:1px solid #cbd5e1;border-radius:5px;padding:3px 9px;color:#172033;background:#fff}.notebook-markdown-content{padding:14px 17px}.notebook-output-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;border-top:1px solid #cbd5e1}.notebook-output-stack{padding:10px 12px 12px 0;min-width:0}.notebook-output-text,.notebook-error-output pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border:1px solid #cbd5e1;border-radius:6px}.notebook-output-image img{max-width:100%;max-height:620px}.notebook-output-note{font-size:11px;color:#64748b;padding:8px}</style></head><body>${content}</body></html>`;
    const destination = await save({ defaultPath: `${title}.html`, filters: [{ name: "HTML", extensions: ["html"] }] }); if (!destination) return;
    await writeTextFile(destination, html);
    const missing = content.includes('data-export-warning="image-not-embedded"') || content.includes('data-export-warning="no-document-path"');
    showToast(missing ? `${langText("Eksport HTML zakończony, ale nie udało się osadzić części obrazów", "HTML export completed, but some images could not be embedded")}: ${destination}` : `${langText("Eksport HTML zakończony. Obrazy osadzono w pliku. Ścieżka", "HTML export completed. Images were embedded. Path")}: ${destination}`);
    $("statusText").textContent = `${langText("Eksport", "Export")}: ${destination}`;
  } catch (error) { await appAlert(`${langText("Nie udało się wyeksportować dokumentu", "Could not export document")}:\n${String(error)}`); }
}
export async function printDocument() {
  try { $("statusText").textContent = langText("Przygotowywanie wydruku…", "Preparing print…"); const html = await renderFullDocument(); printArea.innerHTML = html; resolveLocalImages(printArea); window.print(); $("statusText").textContent = langText("Gotowy · TypeNova", "Ready · TypeNova"); }
  catch (error) { await appAlert(`${langText("Nie udało się przygotować wydruku", "Could not prepare print")}:\n${String(error)}`); }
}

export function initExportPrint(): void {
  window.addEventListener("afterprint", () => { printArea.replaceChildren(); });
}
