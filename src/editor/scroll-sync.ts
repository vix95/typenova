/** Synchronised scrolling between editor and preview, with gesture-ownership locking. */
import { preview } from "../app/workspace-dom";
import { view } from "./editor-view";
import { updateMinimapViewport } from "./minimap";
import { updateActiveOutline } from "../outline/outline";
import { previewContentScrollTop, previewPaddingTop } from "../preview/preview-observers";
import { cancelQueuedPreviewAnchor } from "../preview/preview-scroll-memory";
import { previewState } from "../preview/preview-state";
import { findBlockAtOffset, scheduleVirtualRefresh } from "../preview/virtual-window";

// Scroll synchronization is locked to the pane the user is actively scrolling.
// This prevents delayed programmatic scroll events and virtual-preview height
// corrections from feeding back into the other pane and causing one-line jitter.
type ScrollPane = "preview" | "editor";
export let scrollSyncIdleTimer = 0;
const SCROLL_SYNC_IDLE_MS = 240;
export const scrollSyncState = {
  syncScroll: (localStorage.getItem("typenova.syncScroll") !== "false") as boolean,
  scrollSyncOwner: null as ScrollPane | null,
  expectedPreviewScrollTop: null as number | null,
  expectedEditorScrollTop: null as number | null,
};
function findPreviewBlockForLine(line: number): number {
  let lo = 0, hi = previewState.previewBlocks.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (previewState.previewBlocks[mid].startLine <= line) lo = mid + 1; else hi = mid; }
  return Math.max(0, Math.min(previewState.previewBlocks.length - 1, lo - 1));
}
function armScrollSyncIdleTimer(source: ScrollPane) {
  window.clearTimeout(scrollSyncIdleTimer);
  scrollSyncIdleTimer = window.setTimeout(() => {
    if (scrollSyncState.scrollSyncOwner === source) scrollSyncState.scrollSyncOwner = null;
    // Expected positions are only feedback guards for the current scroll burst.
    scrollSyncState.expectedPreviewScrollTop = null;
    scrollSyncState.expectedEditorScrollTop = null;
  }, SCROLL_SYNC_IDLE_MS);
}
function markScrollSyncIntent(source: ScrollPane) {
  cancelQueuedPreviewAnchor();
  if (!scrollSyncState.syncScroll) return;
  scrollSyncState.scrollSyncOwner = source;
  // A real input gesture takes precedence over any pending programmatic target.
  if (source === "preview") scrollSyncState.expectedPreviewScrollTop = null;
  else scrollSyncState.expectedEditorScrollTop = null;
  armScrollSyncIdleTimer(source);
}
function setSyncedScroll(target: ScrollPane, value: number) {
  const element = target === "preview" ? preview : view.scrollDOM;
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  const next = Math.max(0, Math.min(max, value));
  if (Math.abs(element.scrollTop - next) < 1) return;
  if (target === "preview") scrollSyncState.expectedPreviewScrollTop = next;
  else scrollSyncState.expectedEditorScrollTop = next;
  element.scrollTop = next;
}
function consumeExpectedScroll(target: ScrollPane): boolean {
  const expected = target === "preview" ? scrollSyncState.expectedPreviewScrollTop : scrollSyncState.expectedEditorScrollTop;
  if (expected === null) return false;
  // Treat the next scroll event as programmatic even if layout/scroll-height
  // clamping changed the final value slightly. Actual user intent clears this
  // guard before scrolling, so mismatches should never trigger reverse syncing.
  if (target === "preview") scrollSyncState.expectedPreviewScrollTop = null; else scrollSyncState.expectedEditorScrollTop = null;
  return true;
}
function handleSynchronizedScroll(source: ScrollPane) {
  if (!scrollSyncState.syncScroll) return;
  // One pane owns the current gesture. Ignore scrolls caused by synchronizing
  // the other pane, even if the browser coalesces or delays their scroll events.
  if (scrollSyncState.scrollSyncOwner !== null && scrollSyncState.scrollSyncOwner !== source) { consumeExpectedScroll(source); return; }
  if (consumeExpectedScroll(source)) return;
  if (scrollSyncState.scrollSyncOwner === null) scrollSyncState.scrollSyncOwner = source;
  armScrollSyncIdleTimer(source);
  if (source === "editor") syncPreviewToEditor();
  else syncEditorToPreview();
}
function editorLineVerticalRange(startLine: number, endLine: number): { top: number; bottom: number } {
  const doc = view.state.doc;
  const first = doc.line(Math.max(1, Math.min(doc.lines, startLine)));
  const last = doc.line(Math.max(first.number, Math.min(doc.lines, endLine)));
  const topInfo = view.lineBlockAt(first.from);
  const bottomInfo = view.lineBlockAt(last.to);
  const top = topInfo.top;
  return { top, bottom: Math.max(top + 1, bottomInfo.bottom) };
}
export function syncPreviewToEditor() {
  if (!scrollSyncState.syncScroll || !previewState.previewVisible || !previewState.previewBlocks.length) return;
  const rect = view.scrollDOM.getBoundingClientRect();
  const viewportInset = Math.min(8, rect.height / 2);
  const pos = view.posAtCoords({ x: rect.left + 8, y: rect.top + viewportInset });
  if (pos === null) return;
  const line = view.state.doc.lineAt(pos).number;
  const index = findPreviewBlockForLine(line), block = previewState.previewBlocks[index];
  if (!block) return;
  const editorRange = editorLineVerticalRange(block.startLine, block.endLine);
  const editorPoint = view.scrollDOM.scrollTop + viewportInset;
  const editorSpan = Math.max(1, editorRange.bottom - editorRange.top);
  const fraction = Math.max(0, Math.min(1, (editorPoint - editorRange.top) / editorSpan));
  const previewHeight = Math.max(1, (previewState.blockOffsets[index + 1] || 0) - (previewState.blockOffsets[index] || 0));
  // Map continuous vertical progress inside the source block, not the rounded
  // line number. This avoids a one-line jump whenever a fraction crosses .5.
  setSyncedScroll("preview", previewPaddingTop() + (previewState.blockOffsets[index] || 0) + fraction * previewHeight);
}
function syncEditorToPreview() {
  if (!scrollSyncState.syncScroll || !previewState.previewBlocks.length) return;
  const offset = previewContentScrollTop();
  const index = findBlockAtOffset(offset), block = previewState.previewBlocks[index];
  if (!block) return;
  const top = previewState.blockOffsets[index] || 0;
  const height = Math.max(1, (previewState.blockOffsets[index + 1] || top + 1) - top);
  const fraction = Math.max(0, Math.min(1, (offset - top) / height));
  const editorRange = editorLineVerticalRange(block.startLine, block.endLine);
  setSyncedScroll("editor", editorRange.top + fraction * (editorRange.bottom - editorRange.top));
}
function isScrollNavigationKey(event: KeyboardEvent): boolean {
  return ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
    && !event.altKey && !event.ctrlKey && !event.metaKey;
}
function attachScrollIntentListeners(element: HTMLElement, source: ScrollPane) {
  element.addEventListener("wheel", () => markScrollSyncIntent(source), { passive: true });
  element.addEventListener("touchstart", () => markScrollSyncIntent(source), { passive: true });
  element.addEventListener("keydown", event => { if (isScrollNavigationKey(event as KeyboardEvent)) markScrollSyncIntent(source); }, true);
  // A scrollbar drag does not emit wheel/touch events. Detect pointer presses
  // close to the vertical scrollbar without treating text selection as intent.
  element.addEventListener("pointerdown", event => {
    const pointer = event as PointerEvent, rect = element.getBoundingClientRect();
    if (pointer.clientX >= rect.right - 18 && pointer.clientX <= rect.right) markScrollSyncIntent(source);
  }, true);
}

export function initScrollSync(): void {
  attachScrollIntentListeners(view.scrollDOM, "editor");
  attachScrollIntentListeners(preview, "preview");
  view.scrollDOM.addEventListener("scroll", () => {
    updateMinimapViewport();
    updateActiveOutline();
    handleSynchronizedScroll("editor");
  }, { passive: true });
  preview.addEventListener("scroll", () => {
    scheduleVirtualRefresh();
    handleSynchronizedScroll("preview");
  }, { passive: true });
}
