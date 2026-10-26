/** Resize and intersection observers for the preview, plus its click handling. */
import { preview, previewContent } from "../app/workspace-dom";
import { scrollSyncState } from "../editor/scroll-sync";
import { langText } from "../i18n/language";
import { blockIndex, forceRenderIndices, heightCache, htmlCache, pendingRenderIndices, previewState } from "./preview-state";
import { pumpWorker } from "./preview-worker-client";
import { findBlockAtOffset, rebuildBlockOffsets, scheduleVirtualRefresh } from "./virtual-window";
import { appConfirm } from "../ui/dialogs";

export let resizeObserver: ResizeObserver | null = null;
export function previewPaddingTop(): number {
  const panePadding = Number.parseFloat(getComputedStyle(preview).paddingTop) || 0;
  const contentPadding = Number.parseFloat(getComputedStyle(previewContent).paddingTop) || 0;
  return panePadding + contentPadding;
}
export function previewContentScrollTop(): number {
  return Math.max(0, preview.scrollTop - previewPaddingTop());
}
function setupPreviewObservers() {
  if (typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver(entries => {
    // Preserve the same point inside the anchor block while its measured height changes.
    // Disabling native scroll anchoring in CSS avoids a second, competing correction.
    const contentTop = previewContentScrollTop();
    const anchor = findBlockAtOffset(contentTop);
    const oldAnchorTop = previewState.blockOffsets[anchor] || 0;
    const oldAnchorHeight = Math.max(1, (previewState.blockOffsets[anchor + 1] || oldAnchorTop + 1) - oldAnchorTop);
    const anchorFraction = Math.max(0, Math.min(1, (contentTop - oldAnchorTop) / oldAnchorHeight));
    let changed = false;
    for (const entry of entries) {
      const el = entry.target as HTMLElement, key = el.dataset.key;
      if (!key || !blockIndex.has(key)) continue;
      // A block that was just taken out of the DOM (virtual window moved) or is hidden reports a size of 0. Caching that
      // as a height would shift every offset below it and make the preview jump when the block comes back.
      if (!el.isConnected || (entry.contentRect.width === 0 && entry.contentRect.height === 0)) continue;
      const sizes = (entry as any).borderBoxSize as ResizeObserverSize[] | ResizeObserverSize | undefined;
      const measured = Array.isArray(sizes) ? sizes[0]?.blockSize : (sizes as ResizeObserverSize | undefined)?.blockSize;
      const height = Math.max(24, measured ?? entry.contentRect.height);
      const old = heightCache.get(key);
      if (old === undefined || Math.abs(old - height) > 1) { heightCache.set(key, height); changed = true; }
    }
    if (changed) {
      rebuildBlockOffsets();
      if (previewState.previewBlocks[anchor]) {
        const newAnchorHeight = Math.max(1, (previewState.blockOffsets[anchor + 1] || 0) - (previewState.blockOffsets[anchor] || 0));
        const nextContentTop = (previewState.blockOffsets[anchor] || 0) + anchorFraction * newAnchorHeight;
        const correctedTop = Math.max(0, previewPaddingTop() + nextContentTop);
        if (Math.abs(preview.scrollTop - correctedTop) >= 1) {
          scrollSyncState.expectedPreviewScrollTop = correctedTop;
          preview.scrollTop = correctedTop;
        }
      }
      scheduleVirtualRefresh();
    }
  });
}

export function initPreviewObservers(): void {
  setupPreviewObservers();
  previewContent.addEventListener("click", async event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-render-large]");
    if (!button) return;
    const index = Number(button.dataset.index); const block = previewState.previewBlocks[index];
    if (!block) return;
    if (block.sourceLength > 1_048_576 && !await appConfirm(langText(`Ten blok ma ${(block.sourceLength / 1_048_576).toFixed(1)} MB. Jego pełny podgląd może chwilowo zwiększyć zużycie pamięci. Renderować?`, `This block is ${(block.sourceLength / 1_048_576).toFixed(1)} MB. Rendering it fully may temporarily increase memory use. Render it?`))) return;
    htmlCache.delete(block.key); const element = button.closest<HTMLElement>(".preview-block"); if (element) delete element.dataset.htmlHash; forceRenderIndices.add(index); pendingRenderIndices.add(index); pumpWorker();
  });
}
