/** Debounced preview scheduling and document-to-preview synchronisation. */
import { $ } from "../app/dom";
import { previewBottomSpacer, previewContent, previewTopSpacer } from "../app/workspace-dom";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { langText } from "../i18n/language";
import { applyWidths } from "../layout/layout";
import { activatePreviewFallback, renderPreviewFallback } from "./preview-fallback";
import { resizeObserver } from "./preview-observers";
import { blockElements, blockIndex, forceRenderIndices, heightCache, htmlCache, pendingRenderIndices, previewState } from "./preview-state";
import { pumpWorker } from "./preview-worker-client";

let previewTimer = 0;
export function clearPreviewCache() {
  for (const element of blockElements.values()) resizeObserver?.unobserve(element);
  htmlCache.clear(); heightCache.clear(); blockElements.clear(); pendingRenderIndices.clear(); forceRenderIndices.clear(); previewState.lastRenderedRange = [-1, -1];
  previewState.previewBlocks = []; blockIndex.clear(); previewState.blockOffsets = [0]; previewState.totalPreviewHeight = 0;
  previewContent.replaceChildren(); previewTopSpacer.style.height = "0px"; previewBottomSpacer.style.height = "0px";
}
export function markStartupReady() {
  const overlay = document.getElementById("startupOverlay");
  if (!overlay || overlay.classList.contains("ready")) return;
  overlay.classList.add("ready"); document.body.classList.remove("booting");
  window.setTimeout(() => overlay.remove(), 260);
}
export function schedulePreview() {
  if (graphPreviewOwnsPreview) return;
  window.clearTimeout(previewTimer);
  const n = view.state.doc.length;
  // Once a document becomes large, always leave synchronous fallback mode.
  if (n >= 250_000) previewState.previewFallbackActive = false;
  previewState.updatePending = true;
  const en = document.documentElement.lang === "en";
  $("renderState").textContent = en ? "Updating preview…" : "Aktualizacja podglądu…";
  // Parsing and rendering run in a Web Worker. A longer debounce for very large
  // sources avoids repeatedly parsing megabytes while the user is still typing.
  const delay = n >= 2_000_000 ? 420 : n >= 750_000 ? 250 : n >= 250_000 ? 150 : 85;
  previewTimer = window.setTimeout(() => {
    if (previewState.previewFallbackActive && view.state.doc.length < 250_000) { previewState.updatePending = false; renderPreviewFallback(); }
    else { try { pumpWorker(); } catch (error) { activatePreviewFallback(error); } }
  }, delay);
}
export function syncPreviewForActiveDocument() {
  const mode = documentMode(documentState.currentPath || documentState.untitledLabel);
  const isPreviewable = mode !== "plain";
  const isNotebook = mode === "notebook";
  previewState.previewVisible = isPreviewable && previewState.previewPreference;
  const pane = $("previewPane") as HTMLElement;
  const layout = $("layout") as HTMLElement;
  const toggle = $("togglePreview") as HTMLButtonElement;
  pane.classList.toggle("hidden", !previewState.previewVisible);
  layout.classList.toggle("preview-hidden", !previewState.previewVisible);
  toggle.disabled = !isPreviewable;
  toggle.classList.toggle("selected", previewState.previewVisible);
  toggle.classList.toggle("primary", previewState.previewVisible);
  toggle.setAttribute("aria-pressed", String(previewState.previewVisible));
  toggle.title = isPreviewable
    ? langText(previewState.previewVisible ? (isNotebook ? "Ukryj widok notebooka" : "Ukryj podgląd") : (isNotebook ? "Pokaż widok notebooka" : "Pokaż podgląd"), previewState.previewVisible ? (isNotebook ? "Hide notebook view" : "Hide preview") : (isNotebook ? "Show notebook view" : "Show preview"))
    : langText("Podgląd jest dostępny dla dokumentów Markdown i notebooków Jupyter", "Preview is available for Markdown documents and Jupyter notebooks");
  const previewLabel = document.querySelector<HTMLElement>(".preview-toolbar-label");
  if (previewLabel) previewLabel.textContent = isNotebook ? langText("Notebook Jupyter", "Jupyter Notebook") : langText("Podgląd", "Preview");
  const formatStatus = $("formatStatus") as HTMLElement | null;
  if (formatStatus) formatStatus.textContent = isNotebook ? "Jupyter Notebook" : mode === "markdown" ? "Markdown" : (documentState.currentPath || documentState.untitledLabel).split(".").pop()?.toUpperCase() || "Text";
  applyWidths();
  requestAnimationFrame(() => view.requestMeasure());
}
