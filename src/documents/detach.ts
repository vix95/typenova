/** Moving a tab's document out of its window: into another TypeNova window under the cursor, or into a new window. */
import { invoke } from "@tauri-apps/api/core";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { view } from "../editor/editor-view";
import { discardDetachedDocument, isDetachedWindow, stageDetachedDocument } from "../app/detached-window";
import { documentState } from "./document-state";
import { activeTab, removeTabWithoutPrompt } from "./tabs";
import { captureViewPosition } from "./view-position";

export type TransferResult = "moved" | "new-window" | "kept";

/**
 * Label of another TypeNova window under the mouse cursor, or null. As a side effect that window is told where the cursor
 * is, so it can show a placeholder tab for the dragged document (`title`) at the drop position.
 */
export async function hoverOtherWindow(title: string): Promise<string | null> {
  try { return await invoke<string | null>("drag_hover", { title }); } catch { return null; }
}

/** The dragged tab no longer hovers another window: that window removes its placeholder tab. */
export function endWindowHover(): void { void invoke("drag_hover_end").catch(() => undefined); }

/** Stages the tab's document (including unsaved edits) for another window and returns the hand-off token. */
function stageTab(tabId: string): string | null {
  const tab = documentState.tabs.find(item => item.id === tabId);
  if (!tab) return null;
  const isActive = tab.id === activeTab()?.id;
  // The active tab's live state is in the editor and in documentState, not yet in the tab object.
  return stageDetachedDocument({
    path: isActive ? documentState.currentPath : tab.path,
    label: tab.label,
    text: isActive ? view.state.doc.toString() : tab.state.doc.toString(),
    savedText: isActive ? documentState.savedText : tab.savedText,
    dirty: isActive ? documentState.dirty : tab.dirty,
    position: isActive ? captureViewPosition() : tab.viewPosition ?? null,
  });
}

/**
 * Moves a tab's document out of this window. If another TypeNova window is under the cursor it receives the document;
 * otherwise a new window opens for it (only when this is not the window's last tab). The text, including unsaved edits,
 * travels with the document, so the tab leaves this window without the unsaved-changes prompt, and only after the
 * receiving window exists. A document window whose only document moved away closes itself.
 */
export async function transferTabOut(tabId: string): Promise<TransferResult> {
  const lastTab = documentState.tabs.length < 2;
  const token = stageTab(tabId);
  if (!token) return "kept";
  let result: TransferResult = "kept";
  try {
    if (await invoke<boolean>("deliver_tab", { token })) result = "moved";
    else if (!lastTab) { await invoke("open_document_window", { token }); result = "new-window"; }
  } catch (error) {
    discardDetachedDocument(token);
    showToast(`${langText("Nie udało się przenieść dokumentu", "Could not move the document")}: ${String(error)}`);
    return "kept";
  }
  if (result === "kept") { discardDetachedDocument(token); return result; }
  if (lastTab && isDetachedWindow) { await invoke("close_current_window"); return result; }
  removeTabWithoutPrompt(tabId);
  showToast(result === "moved"
    ? langText("Dokument przeniesiony do drugiego okna.", "Document moved to the other window.")
    : langText("Dokument otwarty w osobnym oknie.", "Document opened in a separate window."));
  return result;
}
