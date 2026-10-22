/** Main-thread fallback renderer, used only when the preview worker cannot be used. */
import MarkdownIt from "markdown-it";
import { createMarkdownRenderer } from "./markdown-renderer";
import { $ } from "../app/dom";
import { preview, previewBottomSpacer, previewContent, previewTopSpacer } from "../app/workspace-dom";
import { documentMode, updateStats } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { langText } from "../i18n/language";
import { buildOutline } from "../outline/outline";
import { decorateCodeBlocks, resolveLocalImages } from "./code-blocks";
import { observeMermaid } from "./mermaid";
import { resizeObserver } from "./preview-observers";
import { clearPreviewCache, markStartupReady, schedulePreview } from "./preview-scheduler";
import { blockElements, blockIndex, forceRenderIndices, heightCache, htmlCache, pendingRenderIndices, previewState } from "./preview-state";
import { workerResponseTimer } from "./preview-worker-client";

export function ensurePreviewFallbackRenderer(): MarkdownIt {
  if (!previewState.previewFallbackRenderer) previewState.previewFallbackRenderer = createMarkdownRenderer();
  return previewState.previewFallbackRenderer;
}
/**
 * Graph section excerpts can use both Markdown-it-texmath dollar delimiters and
 * the common LaTeX \(...\) / \[...\] notation. Normalize only prose outside
 * fenced/inline code so formulas are rendered just like they are in Preview.
 */
export function normalizeGraphWikiImageEmbeds(markdown: string): string {
  let fenceChar = "", fenceLength = 0;
  return markdown.split(/\r?\n/).map(line => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { const marker = fence[1][0], length = fence[1].length; if (!fenceChar) { fenceChar = marker; fenceLength = length; return line; } if (marker === fenceChar && length >= fenceLength) { fenceChar = ""; fenceLength = 0; } return line; }
    if (fenceChar) return line;
    return line.split(/(`+[^`]*?`+)/g).map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/!\[\[([^\]\n]+)\]\]/g, (_match, raw: string) => {
        const values = raw.split("|"); const target = (values.shift() || "").trim(); if (!target) return _match;
        const option = values.join("|").trim(); const alt = option && !/^\d+(?:px)?$/i.test(option) && !/^width\s*=/i.test(option) ? option : target.split(/[\/\\]/).pop() || target;
        const safeTarget = target.includes(" ") || /[()]/.test(target) ? `<${target.replace(/>/g, "%3E")}>` : target;
        return `![${alt.replace(/\]/g, "\\]")}](${safeTarget})`;
      });
    }).join("");
  }).join("\n");
}
export function normalizeGraphMathDelimiters(markdown: string): string {
  let fenceChar = "", fenceLength = 0;
  return markdown.split(/\r?\n/).map(line => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1][0], length = fence[1].length;
      if (!fenceChar) { fenceChar = marker; fenceLength = length; return line; }
      if (marker === fenceChar && length >= fenceLength) { fenceChar = ""; fenceLength = 0; }
      return line;
    }
    if (fenceChar) return line;
    if (/^\s*\\\[\s*$/.test(line)) return line.replace(/\\\[/, () => "$$");
    if (/^\s*\\\]\s*$/.test(line)) return line.replace(/\\\]/, () => "$$");
    if (/^\s*\\begin\{(?:equation|align|gather|displaymath|math)\*?\}\s*$/.test(line)) return line.replace(/\\begin\{[^}]+\}/, () => "$$");
    if (/^\s*\\end\{(?:equation|align|gather|displaymath|math)\*?\}\s*$/.test(line)) return line.replace(/\\end\{[^}]+\}/, () => "$$");
    return line.split(/(`+[^`]*?`+)/g).map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\\\((.+?)\\\)/g, (_match, formula: string) => `$${formula}$`)
        .replace(/\\\[(.+?)\\\]/g, (_match, formula: string) => `$$${formula}$$`);
    }).join("");
  }).join("\n");
}
export function renderPreviewFallback() {
  if (graphPreviewOwnsPreview) return;
  try {
    if (documentMode() === "notebook") {
      previewContent.replaceChildren(); previewTopSpacer.style.height = "0px"; previewBottomSpacer.style.height = "0px";
      const panel = document.createElement("div"); panel.className = "notebook-invalid";
      const title = document.createElement("strong"); title.textContent = langText("Widok notebooka jest niedostępny", "Notebook preview is unavailable");
      const detail = document.createElement("p"); detail.textContent = langText("Nie udało się uruchomić renderera w tle. Źródło notebooka nadal jest dostępne w edytorze.", "The background notebook renderer could not start. The notebook source remains available in the editor.");
      panel.append(title, detail); previewContent.append(panel); preview.scrollTop = 0;
      $("renderState").textContent = langText("Podgląd notebooka niedostępny", "Notebook preview unavailable"); markStartupReady(); return;
    }
    const fallbackRenderer = ensurePreviewFallbackRenderer();
    const source = view.state.doc.toString();
    const env: Record<string, any> = {};
    const tokens = fallbackRenderer.parse(source, env);
    const html = fallbackRenderer.renderer.render(tokens, fallbackRenderer.options, env);
    const headings: { level: number; text: string; line: number }[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "heading_open") continue;
      const inline = tokens[i + 1]?.type === "inline" ? tokens[i + 1] : null;
      const text = String(inline?.content || "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "").trim();
      headings.push({ level: Number(String(token.tag || "h1").slice(1)) || 1, text: text || "(untitled)", line: (token.map?.[0] ?? 0) + 1 });
    }
    buildOutline(headings);
    previewContent.innerHTML = html; previewTopSpacer.style.height = "0px"; previewBottomSpacer.style.height = "0px";
    decorateCodeBlocks(previewContent); resolveLocalImages(previewContent); observeMermaid(previewContent);
    const wordMatches = source.match(/[\p{L}\p{N}_'-]+/gu) || [];
    updateStats({ words: wordMatches.length, chars: source.length, bytes: new TextEncoder().encode(source).byteLength });
    $("renderState").textContent = langText("Podgląd lokalny", "Local preview"); markStartupReady();
  } catch (error) { $("renderState").textContent = langText("Błąd podglądu", "Preview error"); console.error("TypeNova preview fallback failed:", error); markStartupReady(); }
}
export function activatePreviewFallback(reason: unknown) {
  window.clearTimeout(workerResponseTimer);
  previewState.updatePending = false; previewState.workerBusy = false; previewState.activeWorkerRequest = null;
  try { previewState.renderWorker?.terminate(); } catch { } previewState.renderWorker = null;
  for (const element of blockElements.values()) resizeObserver?.unobserve(element);
  blockElements.clear(); htmlCache.clear(); heightCache.clear(); pendingRenderIndices.clear(); forceRenderIndices.clear(); previewState.previewBlocks = []; blockIndex.clear(); previewState.blockOffsets = [0]; previewState.totalPreviewHeight = 0;
  console.error("TypeNova preview worker failed:", reason);
  if (graphPreviewOwnsPreview) { previewState.previewFallbackActive = view.state.doc.length < 250_000; return; }
  // Never fall back to parsing a large source on the UI thread. Show a recoverable
  // in-app error and let the user retry the worker; the editor stays responsive.
  if (view.state.doc.length >= 250_000) {
    previewState.previewFallbackActive = false;
    previewContent.replaceChildren(); previewTopSpacer.style.height = "0px"; previewBottomSpacer.style.height = "0px";
    const panel = document.createElement("div"); panel.className = "preview-worker-error";
    const title = document.createElement("strong"); title.textContent = langText("Podgląd został wstrzymany, aby zachować płynność edytora.", "Preview paused to keep the editor responsive.");
    const detail = document.createElement("p"); detail.textContent = langText("Proces renderowania w tle zakończył się błędem. Treść dokumentu nie została utracona.", "The background renderer stopped unexpectedly. Your document has not been changed.");
    const retry = document.createElement("button"); retry.className = "primary"; retry.textContent = langText("Ponów renderowanie", "Retry preview"); retry.addEventListener("click", () => { previewState.previewFallbackActive = false; clearPreviewCache(); schedulePreview(); });
    panel.append(title, detail, retry); previewContent.append(panel); preview.scrollTop = 0;
    $("renderState").textContent = langText("Podgląd wstrzymany", "Preview paused"); markStartupReady(); return;
  }
  previewState.previewFallbackActive = true;
  renderPreviewFallback();
}
