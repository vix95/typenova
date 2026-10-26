/** Remembers the preview reading position of a tab and restores it once the tab's preview has been rebuilt. */
import { preview } from "../app/workspace-dom";
import { scrollSyncState } from "../editor/scroll-sync";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { previewContentScrollTop, previewPaddingTop } from "./preview-observers";
import { previewState } from "./preview-state";
import { findBlockAtOffset, scheduleVirtualRefresh } from "./virtual-window";

import type { PreviewAnchor } from "../documents/session";

let pendingAnchor: PreviewAnchor | null = null;
let pendingSince = 0;
/** A queued position that is not applied within this time is stale (for example the preview was hidden) and must not move the view later. */
const PENDING_ANCHOR_TTL_MS = 5000;

export function capturePreviewAnchor(): PreviewAnchor | null {
  if (graphPreviewOwnsPreview || !previewState.previewBlocks.length || previewState.previewFallbackActive) return null;
  const offset = previewContentScrollTop();
  const index = findBlockAtOffset(offset), block = previewState.previewBlocks[index];
  if (!block) return null;
  const top = previewState.blockOffsets[index] || 0;
  const height = Math.max(1, (previewState.blockOffsets[index + 1] || top + 1) - top);
  return { line: block.startLine, fraction: Math.max(0, Math.min(1, (offset - top) / height)) };
}

/** Queues the position to apply after the next completed preview update (null clears any queued position). */
export function hasQueuedPreviewAnchor(): boolean { return pendingAnchor !== null && performance.now() - pendingSince < PENDING_ANCHOR_TTL_MS; }
export function queuePreviewAnchorRestore(anchor: PreviewAnchor | null): void { pendingAnchor = anchor; pendingSince = performance.now(); }
/** The user took over scrolling: a remembered position must no longer override it. */
export function cancelQueuedPreviewAnchor(): void { pendingAnchor = null; }

export function applyQueuedPreviewAnchor(): void {
  const anchor = hasQueuedPreviewAnchor() ? pendingAnchor : null; pendingAnchor = null;
  if (!anchor || !previewState.previewBlocks.length) return;
  let index = 0;
  previewState.previewBlocks.forEach((block, i) => { if (block.startLine <= anchor.line) index = i; });
  const top = previewState.blockOffsets[index] || 0;
  const height = Math.max(1, (previewState.blockOffsets[index + 1] || top + 1) - top);
  const target = Math.max(0, previewPaddingTop() + top + anchor.fraction * height);
  // Mark the scroll as programmatic so scroll synchronisation does not treat it as user input.
  scrollSyncState.expectedPreviewScrollTop = target;
  preview.scrollTop = target;
  scheduleVirtualRefresh();
}
