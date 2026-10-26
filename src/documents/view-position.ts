/** Remembers where each document was scrolled to (editor line and preview anchor), in memory and in the saved session. */
import { EditorView } from "@codemirror/view";
import { preview } from "../app/workspace-dom";
import { view } from "../editor/editor-view";
import { capturePreviewAnchor, hasQueuedPreviewAnchor, queuePreviewAnchorRestore } from "../preview/preview-scroll-memory";
import { documentState, type DocumentTab } from "./document-state";
import { persistOpenSession } from "./tabs";
import { normalizeSessionPath, type ViewPosition, type ViewPositions } from "./session";

const PERSIST_DELAY_MS = 800;

export function captureViewPosition(): ViewPosition {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return { editorLine: view.state.doc.lineAt(block.from).number, preview: capturePreviewAnchor() };
}

/** Stores the current scroll position on a tab (the tab that is being left, or the active one before the app closes). */
export function rememberViewPosition(tab: DocumentTab): void { tab.viewPosition = captureViewPosition(); }

/** Applies a stored position to the document that is now shown; the preview part waits for the rebuilt preview blocks. */
export function restoreViewPosition(position: ViewPosition | null | undefined): void {
  queuePreviewAnchorRestore(position?.preview ?? null);
  if (!position || position.editorLine <= 1) return;
  const line = view.state.doc.line(Math.min(position.editorLine, view.state.doc.lines));
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
}

/** Positions of all file-backed tabs, keyed by normalised path, for the saved session. */
export function viewPositionsForSession(): ViewPositions {
  const positions: ViewPositions = {};
  for (const tab of documentState.tabs) if (tab.path && tab.viewPosition) positions[normalizeSessionPath(tab.path)] = tab.viewPosition;
  return positions;
}

/** Keeps the active tab's position up to date while the user scrolls and saves the session shortly after scrolling stops. */
export function initViewPositionPersistence(): void {
  let timer = 0;
  const capture = () => {
    // While a restored preview position is still waiting for its blocks, the current scroll is not the reading position.
    if (hasQueuedPreviewAnchor()) { timer = window.setTimeout(capture, PERSIST_DELAY_MS); return; }
    const tab = documentState.tabs.find(item => item.id === documentState.activeTabId);
    if (!tab || !documentState.startupSessionReady) return;
    rememberViewPosition(tab); persistOpenSession();
  };
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(capture, PERSIST_DELAY_MS); };
  view.scrollDOM.addEventListener("scroll", schedule, { passive: true });
  preview.addEventListener("scroll", schedule, { passive: true });
}
