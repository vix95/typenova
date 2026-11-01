/** Hidden sections in the preview: their blocks take no space and are not rendered. */
import type { HiddenRange } from "../documents/section-ranges";
import { applyQueuedPreviewAnchor, capturePreviewAnchor, queuePreviewAnchorRestore } from "./preview-scroll-memory";
import { previewState } from "./preview-state";
import { rebuildBlockOffsets, renderVirtualWindow } from "./virtual-window";

/** Flags every block that lies entirely inside a hidden range. Blocks and ranges are both in document order. */
export function markHiddenBlocks(): void {
  const ranges = previewState.hiddenLineRanges;
  let rangeIndex = 0;
  for (const block of previewState.previewBlocks) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].endLine < block.startLine) rangeIndex++;
    const range = ranges[rangeIndex];
    block.hidden = !!range && block.startLine >= range.startLine && block.endLine <= range.endLine;
  }
}

/** Applies a new set of hidden ranges to the blocks already known, keeping the reading position. */
export function setPreviewHiddenRanges(ranges: readonly HiddenRange[]): void {
  previewState.hiddenLineRanges = [...ranges];
  if (!previewState.previewBlocks.length) return;
  const anchor = capturePreviewAnchor();
  markHiddenBlocks();
  rebuildBlockOffsets();
  previewState.lastRenderedRange = [-1, -1];
  renderVirtualWindow(true);
  queuePreviewAnchorRestore(anchor);
  applyQueuedPreviewAnchor();
}
