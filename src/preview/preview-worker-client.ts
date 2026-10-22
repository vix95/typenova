/** Preview worker lifecycle and message protocol (revision checks, timeouts, stale-result rejection). */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { documentMode, updateStats } from "../documents/document-stats";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { buildOutline } from "../outline/outline";
import { activatePreviewFallback } from "./preview-fallback";
import { markStartupReady } from "./preview-scheduler";
import { blockIndex, forceRenderIndices, heightCache, htmlCache, pendingRenderIndices, previewState, type PreviewBlock } from "./preview-state";
import { rebuildBlockOffsets, renderVirtualWindow } from "./virtual-window";

let workerRequestId = 0;
let workerRevision = -1;
export let workerResponseTimer = 0;
function ensureWorker() {
  if (previewState.renderWorker) return previewState.renderWorker;
  previewState.renderWorker = new Worker(new URL("../preview.worker.ts", import.meta.url), { type: "module" });
  previewState.renderWorker.addEventListener("message", onWorkerMessage);
  previewState.renderWorker.addEventListener("error", (event: ErrorEvent) => {
    activatePreviewFallback(event.message);
  });
  return previewState.renderWorker;
}
function currentVisibleLines() {
  const from = view.state.doc.lineAt(Math.min(view.viewport.from, view.state.doc.length)).number;
  const to = view.state.doc.lineAt(Math.min(view.viewport.to, view.state.doc.length)).number;
  return { from: Math.max(1, from - 20), to: to + 40 };
}
function armWorkerTimeout() {
  window.clearTimeout(workerResponseTimer);
  const timeout = view.state.doc.length >= 2_000_000 ? 30000 : 15000;
  workerResponseTimer = window.setTimeout(() => {
    if (!previewState.workerBusy) return;
    // Do not switch a large document to synchronous main-thread rendering. Keep
    // the worker alive and report that it is still processing instead.
    $("renderState").textContent = langText("Podgląd nadal przetwarza duży dokument…", "Preview is still processing a large document…");
    armWorkerTimeout();
  }, timeout);
}
export function pumpWorker() {
  if (previewState.workerBusy) return;
  let worker: Worker;
  try { worker = ensureWorker(); }
  catch (error) { activatePreviewFallback(error); return; }
  if (previewState.updatePending) {
    previewState.updatePending = false;
    pendingRenderIndices.clear(); forceRenderIndices.clear();
    const id = ++workerRequestId, revision = documentState.docRevision, text = view.state.doc.toString();
    const visible = currentVisibleLines();
    previewState.workerBusy = true; previewState.activeWorkerRequest = { id, action: "update", revision };
    worker.postMessage({ id, action: "update", revision, text, mode: documentMode(), language: document.documentElement.lang === "en" ? "en" : "pl", visibleFromLine: visible.from, visibleToLine: visible.to });
    armWorkerTimeout();
    return;
  }
  if (pendingRenderIndices.size && workerRevision === documentState.docRevision) {
    const indexes = Array.from(pendingRenderIndices).slice(0, 160);
    indexes.forEach(index => pendingRenderIndices.delete(index));
    const id = ++workerRequestId, revision = workerRevision;
    const forceIndexes = indexes.filter(index => forceRenderIndices.has(index)); forceIndexes.forEach(index => forceRenderIndices.delete(index));
    previewState.workerBusy = true; previewState.activeWorkerRequest = { id, action: "render", revision };
    worker.postMessage({ id, action: "render", revision, indexes, forceIndexes });
    armWorkerTimeout();
  }
}
function onWorkerMessage(event: MessageEvent) {
  window.clearTimeout(workerResponseTimer);
  const data = event.data;
  if (!previewState.activeWorkerRequest || data.id !== previewState.activeWorkerRequest.id) return;
  const request = previewState.activeWorkerRequest;
  previewState.workerBusy = false; previewState.activeWorkerRequest = null;
  if (data.error) {
    activatePreviewFallback(data.error);
    return;
  }
  if (request.action === "update") {
    pendingRenderIndices.clear();
    if (request.revision !== documentState.docRevision || data.revision !== documentState.docRevision) {
      previewState.updatePending = true;
      pumpWorker();
      return;
    }
    workerRevision = data.revision;
    const oldHeights = new Map(heightCache);
    previewState.previewBlocks = data.blocks as PreviewBlock[];
    if (view.state.doc.length > 0 && previewState.previewBlocks.length === 0) { activatePreviewFallback("Worker returned no preview blocks for a non-empty document"); return; }
    blockIndex.clear();
    const validKeys = new Set<string>();
    previewState.previewBlocks.forEach((block, index) => {
      blockIndex.set(block.key, index); validKeys.add(block.key);
      if (!heightCache.has(block.key) && oldHeights.has(block.key)) heightCache.set(block.key, oldHeights.get(block.key)!);
    });
    for (const key of Array.from(heightCache.keys())) if (!validKeys.has(key)) heightCache.delete(key);
    for (const key of Array.from(htmlCache.keys())) if (!validKeys.has(key)) htmlCache.delete(key);
    for (const item of data.rendered || []) htmlCache.set(item.key, item.html);
    rebuildBlockOffsets();
    buildOutline(data.headings || []);
    updateStats(data.stats);
    previewState.lastRenderedRange = [-1, -1];
    renderVirtualWindow(true); markStartupReady();
    const elapsed = Number(data.parseMs || 0) + Number(data.renderMs || 0);
    $("renderState").textContent = `${data.stats?.fastMode ? langText("Szybki tryb · ", "Fast mode · ") : ""}${previewState.previewBlocks.length.toLocaleString(document.documentElement.lang === "en" ? "en-US" : "pl-PL")} ${langText("bloków", "blocks")} · ${(elapsed / 1000).toFixed(2)} s`;
  } else if (request.action === "render") {
    if (request.revision === documentState.docRevision && data.revision === workerRevision) {
      for (const item of data.rendered || []) htmlCache.set(item.key, item.html);
      renderVirtualWindow(true);
    } else if (request.revision !== documentState.docRevision) previewState.updatePending = true;
  }
  pumpWorker();
}
