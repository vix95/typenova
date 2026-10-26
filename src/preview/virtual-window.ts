/** Virtualised preview window: block offsets and visible-range rendering. */
import { preview, previewBottomSpacer, previewContent, previewTopSpacer } from "../app/workspace-dom";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { decorateCodeBlocks, resolveLocalImages } from "./code-blocks";
import { observeMermaid } from "./mermaid";
import { previewContentScrollTop, resizeObserver } from "./preview-observers";
import { blockElements, blockIndex, heightCache, htmlCache, pendingRenderIndices, previewState } from "./preview-state";
import { pumpWorker } from "./preview-worker-client";

export function rebuildBlockOffsets() {
  previewState.blockOffsets = new Array(previewState.previewBlocks.length + 1);
  previewState.blockOffsets[0] = 0;
  for (let i = 0; i < previewState.previewBlocks.length; i++) {
    const b = previewState.previewBlocks[i];
    previewState.blockOffsets[i + 1] = previewState.blockOffsets[i] + Math.max(24, heightCache.get(b.key) ?? b.estimatedHeight);
  }
  previewState.totalPreviewHeight = previewState.blockOffsets[previewState.previewBlocks.length] || 0;
}
export function findBlockAtOffset(offset: number) {
  let lo = 0, hi = previewState.previewBlocks.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (previewState.blockOffsets[mid + 1] < offset) lo = mid + 1; else hi = mid; }
  return Math.min(Math.max(0, lo), Math.max(0, previewState.previewBlocks.length - 1));
}
export function scheduleVirtualRefresh() {
  if (previewState.previewFallbackActive) return;
  if ((scheduleVirtualRefresh as any).pending) return;
  (scheduleVirtualRefresh as any).pending = true;
  requestAnimationFrame(() => { (scheduleVirtualRefresh as any).pending = false; renderVirtualWindow(); });
}
export function renderVirtualWindow(force = false) {
  if (graphPreviewOwnsPreview || previewState.previewFallbackActive) return;
  if (!previewState.previewBlocks.length) {
    previewContent.replaceChildren(); previewTopSpacer.style.height = "0px"; previewBottomSpacer.style.height = "0px"; previewState.lastRenderedRange = [-1, -1]; return;
  }
  if (!previewState.blockOffsets.length || previewState.blockOffsets.length !== previewState.previewBlocks.length + 1) rebuildBlockOffsets();
  const scrollTop = previewContentScrollTop(), viewportHeight = Math.max(1, preview.clientHeight || 600);
  const visibleStart = findBlockAtOffset(scrollTop), visibleEnd = findBlockAtOffset(scrollTop + viewportHeight);
  const start = Math.max(0, visibleStart - 8), end = Math.min(previewState.previewBlocks.length - 1, visibleEnd + 8);
  previewTopSpacer.style.height = `${previewState.blockOffsets[start]}px`;
  previewBottomSpacer.style.height = `${Math.max(0, previewState.totalPreviewHeight - previewState.blockOffsets[end + 1])}px`;
  if (force || start !== previewState.lastRenderedRange[0] || end !== previewState.lastRenderedRange[1]) {
    const fragment = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      const block = previewState.previewBlocks[i];
      let element = blockElements.get(block.key);
      if (!element) { element = document.createElement("section"); element.className = "preview-block"; element.dataset.key = block.key; blockElements.set(block.key, element); }
      element.dataset.index = String(i); element.dataset.startLine = String(block.startLine); element.dataset.endLine = String(block.endLine);
      const html = htmlCache.get(block.key);
      if (html !== undefined) {
        if (element.dataset.htmlHash !== block.hash) { element.innerHTML = html; element.dataset.htmlHash = block.hash; decorateCodeBlocks(element); resolveLocalImages(element); observeMermaid(element); }
        element.style.minHeight = "0px";
      } else {
        if (element.dataset.htmlHash) { element.replaceChildren(); delete element.dataset.htmlHash; }
        element.style.minHeight = `${heightCache.get(block.key) ?? block.estimatedHeight}px`;
        pendingRenderIndices.add(i);
      }
      fragment.append(element);
    }
    previewContent.replaceChildren(fragment);
    previewState.lastRenderedRange = [start, end];
    for (const element of Array.from(previewContent.children)) { observeMermaid(element as HTMLElement); if (resizeObserver) resizeObserver.observe(element as HTMLElement); }
    // Bound the HTML/DOM cache. The worker retains parsed tokens, so evicted blocks are cheap to request again.
    for (const key of Array.from(htmlCache.keys())) { const idx = blockIndex.get(key); if (idx !== undefined && (idx < start - 50 || idx > end + 50)) htmlCache.delete(key); }
    for (const [key, element] of Array.from(blockElements.entries())) { const idx = blockIndex.get(key); if (idx === undefined || idx < start - 20 || idx > end + 20) { resizeObserver?.unobserve(element); element.remove(); blockElements.delete(key); } }
  }
  for (let i = start; i <= end; i++)if (!htmlCache.has(previewState.previewBlocks[i].key)) pendingRenderIndices.add(i);
  pumpWorker();
}
