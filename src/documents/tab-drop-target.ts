/** Receiving side of moving a tab between windows: a placeholder tab shows where a dragged document would land, and a document dropped on this window opens in a new tab here. */
import { listen } from "@tauri-apps/api/event";
import { $ } from "../app/dom";
import { takeDetachedDocument } from "../app/detached-window";
import { view } from "../editor/editor-view";
import { documentState } from "./document-state";
import { insertionIndex } from "./tab-order";
import { adoptDocumentTab, removeTabWithoutPrompt } from "./tabs";

type Point = { x: number; y: number };
type HoverPayload = Point & { title: string };
type DropPayload = Point & { token: string };

/** Slack above and below the strip in which the cursor still counts as being over it. */
const STRIP_SLACK_PX = 6;

let skeleton: HTMLElement | null = null;

function tabElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(":scope > .editor-tab[data-tab-id]"));
}

/** Slot in the strip for a point in this window's client coordinates, or null when the point is not over the strip. */
function slotAt(point: Point): number | null {
  const list = $("editorTabList") as HTMLElement;
  const rect = list.getBoundingClientRect();
  const over = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top - STRIP_SLACK_PX && point.y <= rect.bottom + STRIP_SLACK_PX;
  if (!over) return null;
  const middles = tabElements(list).map(tab => { const box = tab.getBoundingClientRect(); return box.left + box.width / 2; });
  return insertionIndex(middles, point.x);
}

/** Shows (or moves) the translucent placeholder tab: at the slot under the cursor, or at the end when the cursor is elsewhere in the window. */
function showSkeleton(title: string, point: Point): void {
  const list = $("editorTabList") as HTMLElement;
  if (!skeleton) {
    skeleton = document.createElement("div");
    skeleton.className = "editor-tab tab-skeleton"; skeleton.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.className = "editor-tab-label";
    skeleton.append(label);
  }
  skeleton.firstElementChild!.textContent = title;
  const tabs = tabElements(list);
  const slot = slotAt(point) ?? tabs.length;
  const before = tabs[slot] ?? null;
  if (skeleton.parentElement !== list || skeleton.nextElementSibling !== before) list.insertBefore(skeleton, before);
  skeleton.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function hideSkeleton(): void { skeleton?.remove(); skeleton = null; }

/** A single empty, unsaved, untouched tab is a placeholder that should give way to the incoming document. */
function pristinePlaceholderTabId(): string | null {
  if (documentState.tabs.length !== 1) return null;
  const only = documentState.tabs[0];
  return !documentState.currentPath && !documentState.dirty && view.state.doc.length === 0 ? only.id : null;
}

export function initTabDropTarget(): void {
  const ignoreMissingEvents = () => { /* events are unavailable outside the desktop app */ };
  void listen<HoverPayload>("tab-drag-over", event => showSkeleton(event.payload.title, event.payload)).catch(ignoreMissingEvents);
  void listen("tab-drag-leave", hideSkeleton).catch(ignoreMissingEvents);
  void listen<DropPayload>("tab-dropped", event => {
    // The slot is computed while the placeholder is still in place (it is not a tab), then the placeholder goes away.
    const slot = slotAt(event.payload);
    hideSkeleton();
    const doc = takeDetachedDocument(event.payload.token);
    if (!doc) return;
    const placeholder = pristinePlaceholderTabId();
    adoptDocumentTab(doc, slot ?? undefined);
    if (placeholder) removeTabWithoutPrompt(placeholder);
  }).catch(ignoreMissingEvents);
}
