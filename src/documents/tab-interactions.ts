/** Editor tab strip interactions: mouse-wheel scrolling, reordering by dragging, moving a tab to another group (or opening a new group beside one) and tearing a tab off into its own window. */
import { invoke } from "@tauri-apps/api/core";
import { $ } from "../app/dom";
import { langText } from "../i18n/language";
import { documentState } from "./document-state";
import { endWindowHover, hoverOtherWindow, transferTabOut } from "./detach";
import { moveTabToGroup, reorderInGroup, splitWithTab } from "./groups";
import { dropTargetAt, hideDropZone, showDropZone, type DropTarget } from "./groups-dom";
import { groupById, groupOf } from "./groups-state";

const DRAG_THRESHOLD_PX = 5;
const EDGE_ZONE_PX = 40;
const EDGE_SCROLL_STEP_PX = 14;
const LINE_HEIGHT_PX = 16;
// Like other editors: dragging a tab out of the tab strip, to somewhere that is neither a strip nor an editor group (this
// far above or below it, in the sidebar or the preview, or out of the window), and releasing it there moves the document
// to the other TypeNova window under the cursor, or opens it in a window of its own; dragging it back cancels that. Over
// the editor groups a tab goes to a strip (a place among its tabs) or to a group (join it, or open a new group beside it).
const DETACH_MARGIN_PX = 48;
const WINDOW_PROBE_INTERVAL_MS = 60;

type Drag = {
  pointerId: number; tabId: string; element: HTMLElement; startX: number; startY: number; startScroll: number;
  active: boolean; pointerX: number; pointerY: number; slot: number; target: DropTarget | null; edgeTimer: number; detach: boolean; outside: boolean; targetWindow: string | null; probeAt: number; ghostHint: string | null; hovering: boolean;
};

type DragEnd = "reorder" | "detach" | "cancel";

function tabElements(list: HTMLElement): HTMLElement[] { return Array.from(list.querySelectorAll<HTMLElement>(":scope > .editor-tab[data-tab-id]")); }


function installWheelScroll(list: HTMLElement): void {
  // Wheel: scroll the strip sideways. A vertical wheel (the common mouse) is mapped to horizontal movement.
  list.addEventListener("wheel", event => {
    if (list.scrollWidth <= list.clientWidth || event.ctrlKey) return;
    const unit = event.deltaMode === 1 ? LINE_HEIGHT_PX : event.deltaMode === 2 ? list.clientWidth : 1;
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
    if (!delta) return;
    event.preventDefault();
    list.scrollLeft += delta;
  }, { passive: false });
}

/** True while the pointer is out of the window, or far enough from the strip, over no strip and no editor group, that releasing would leave this window. */
function isOutside(list: HTMLElement, state: Drag): boolean {
  if (state.pointerX < 0 || state.pointerX > window.innerWidth || state.pointerY < 0 || state.pointerY > window.innerHeight) return true;
  if (dropTargetAt(state.pointerX, state.pointerY, state.tabId)) return false;
  const rect = list.getBoundingClientRect();
  return state.pointerY < rect.top - DETACH_MARGIN_PX || state.pointerY > rect.bottom + DETACH_MARGIN_PX;
}

/** The place marks of every strip (a tab dragged over a strip shows where it would go). */
function clearAllMarks(): void {
  for (const tab of Array.from(document.querySelectorAll<HTMLElement>(".editor-tab.drop-before, .editor-tab.drop-after"))) tab.classList.remove("drop-before", "drop-after");
}

/** Marks the slot in the strip of a group that a tab dragged there would take. */
function markSlot(groupId: string, slot: number, draggedId: string): void {
  clearAllMarks();
  const list = groupById(groupId)?.list;
  if (!list) return;
  const others = tabElements(list).filter(tab => tab.dataset.tabId !== draggedId);
  if (!others.length) return;
  if (slot < others.length) others[slot].classList.add("drop-before"); else others[others.length - 1].classList.add("drop-after");
}

/** What releasing the tab here would do, or null when nothing (over its own group's body, or where a group would be left empty). */
function usableTarget(state: Drag, own: string): DropTarget | null {
  const target = dropTargetAt(state.pointerX, state.pointerY, state.tabId);
  if (!target || target.kind === "strip") return target;
  if (target.groupId === own && (target.zone === "center" || (groupById(own)?.tabIds.length ?? 0) < 2)) return null;
  return target;
}

/** Theme colours for the ghost window, which is a separate document and cannot read this page's CSS variables. */
function ghostColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { panel: read("--ui-panel"), text: read("--ui-text"), muted: read("--ui-muted"), accent: read("--ui-accent") };
}

/**
 * Shows the dragged tab next to the cursor while it is outside the strip. It is a window of its own (not an element of
 * this page), so it stays visible over other TypeNova windows too; the Rust side places it at the real cursor position.
 */
function showGhost(state: Drag): void {
  const hint = state.targetWindow
    ? langText("Zwolnij, aby przenieść do tego okna", "Release to move to that window")
    : langText("Zwolnij, aby otworzyć w nowym oknie", "Release to open in a new window");
  if (state.ghostHint === hint) { void invoke("drag_ghost_move").catch(() => undefined); return; }
  state.ghostHint = hint;
  const title = state.element.querySelector(".editor-tab-label")?.textContent || "";
  void invoke("drag_ghost_show", { payload: JSON.stringify({ title, hint, colors: ghostColors() }) }).catch(() => { state.ghostHint = null; });
}

function hideGhost(state: Drag): void {
  if (state.ghostHint === null) return;
  state.ghostHint = null;
  void invoke("drag_ghost_hide").catch(() => undefined);
}

/** Asks (at most every 60 ms) which other TypeNova window, if any, is under the cursor; that window shows a placeholder tab. */
function probeWindowUnder(state: Drag, stillDragging: () => boolean): void {
  const now = performance.now();
  if (now - state.probeAt < WINDOW_PROBE_INTERVAL_MS) return;
  state.probeAt = now;
  const title = state.element.querySelector(".editor-tab-label")?.textContent || "";
  void hoverOtherWindow(title).then(label => {
    if (!stillDragging() || !state.outside) { if (label) endWindowHover(); return; }
    state.hovering = !!label;
    state.targetWindow = label;
    state.detach = !!label || documentState.tabs.length > 1;
    state.element.classList.toggle("will-detach", state.detach);
    if (state.detach) showGhost(state); else hideGhost(state);
  });
}

/** Reordering by dragging, and tearing a tab off into a window of its own by dragging it out of the strip. */
function installTabDrag(list: HTMLElement): void {
  // Drag and drop with pointer events (more dependable in the desktop webview than native drag and drop).
  let drag: Drag | null = null;
  let suppressClick = false;

  const own = () => list.dataset.group ?? "";
  const clearMarks = () => { clearAllMarks(); hideDropZone(); };
  /** Shows where the tab would land: a place in a strip, or a zone of a group. */
  const updateTarget = (state: Drag) => {
    state.target = usableTarget(state, own());
    if (state.target?.kind === "strip") { hideDropZone(); markSlot(state.target.groupId, state.target.slot, state.tabId); return; }
    clearAllMarks();
    if (state.target) showDropZone(state.target.groupId, state.target.zone); else hideDropZone();
  };
  const follow = (state: Drag) => {
    const raw = state.pointerX - state.startX + (list.scrollLeft - state.startScroll);
    // A transformed element still counts toward the strip's scrollable width, so an unbounded shift would let the strip
    // grow (and autoscroll) forever. Keep the dragged tab between the first and the last slot instead.
    const tabs = tabElements(list), first = tabs[0], last = tabs[tabs.length - 1];
    const min = first.offsetLeft - state.element.offsetLeft;
    const max = last.offsetLeft + last.offsetWidth - (state.element.offsetLeft + state.element.offsetWidth);
    const shift = Math.max(min, Math.min(max, raw));
    state.element.style.transform = `translateX(${shift}px)`;
  };
  const stopEdgeScroll = (state: Drag) => { if (state.edgeTimer) { window.clearInterval(state.edgeTimer); state.edgeTimer = 0; } };
  const syncEdgeScroll = (state: Drag) => {
    const rect = list.getBoundingClientRect();
    const direction = state.pointerX < rect.left + EDGE_ZONE_PX ? -1 : state.pointerX > rect.right - EDGE_ZONE_PX ? 1 : 0;
    if (!direction) { stopEdgeScroll(state); return; }
    if (state.edgeTimer) return;
    state.edgeTimer = window.setInterval(() => {
      const before = list.scrollLeft;
      list.scrollLeft += direction * EDGE_SCROLL_STEP_PX;
      if (list.scrollLeft !== before) { follow(state); updateTarget(state); }
    }, 16);
  };
  const finish = (end: DragEnd) => {
    const state = drag; if (!state) return;
    drag = null; stopEdgeScroll(state); hideGhost(state);
    if (state.hovering) endWindowHover();
    list.classList.remove("is-reordering"); clearMarks();
    state.element.classList.remove("is-dragging", "will-detach"); state.element.style.transform = "";
    try { list.releasePointerCapture(state.pointerId); } catch { /* the capture may already be gone */ }
    if (state.active) { suppressClick = true; window.setTimeout(() => { suppressClick = false; }, 0); }
    if (!state.active) return;
    const target = state.target;
    if (end === "reorder" && target) {
      if (target.kind === "strip") { if (target.groupId === own()) reorderInGroup(target.groupId, state.tabId, target.slot); else moveTabToGroup(state.tabId, target.groupId, target.slot); }
      else if (target.zone === "center") moveTabToGroup(state.tabId, target.groupId);
      else splitWithTab(state.tabId, target.groupId, target.zone);
    } else if (end === "detach") void transferTabOut(state.tabId);
  };

  list.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("[data-close-tab]")) return;
    const element = event.target.closest<HTMLElement>(".editor-tab[data-tab-id]");
    if (!element?.dataset.tabId) return;
    drag = { pointerId: event.pointerId, tabId: element.dataset.tabId, element, startX: event.clientX, startY: event.clientY, startScroll: list.scrollLeft, active: false, pointerX: event.clientX, pointerY: event.clientY, slot: 0, target: null, edgeTimer: 0, detach: false, outside: false, targetWindow: null, probeAt: 0, ghostHint: null, hovering: false };
  });
  // Listening on the document (not the strip) keeps a quick pull out of the strip tracked from its first pixel.
  document.addEventListener("pointermove", event => {
    const state = drag; if (!state || state.pointerId !== event.pointerId) return;
    state.pointerX = event.clientX; state.pointerY = event.clientY;
    if (!state.active) {
      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD_PX) return;
      state.active = true; list.setPointerCapture(event.pointerId);
      list.classList.add("is-reordering"); state.element.classList.add("is-dragging");
    }
    state.outside = isOutside(list, state);
    if (state.outside) probeWindowUnder(state, () => drag === state);
    else { if (state.hovering) { state.hovering = false; endWindowHover(); } state.targetWindow = null; }
    // Outside, the document can go to another window, or (with other tabs left here) to a new one.
    state.detach = state.outside && (!!state.targetWindow || documentState.tabs.length > 1);
    state.element.classList.toggle("will-detach", state.detach);
    if (state.detach) { clearMarks(); stopEdgeScroll(state); follow(state); showGhost(state); return; }
    hideGhost(state);
    if (state.outside) { clearMarks(); stopEdgeScroll(state); follow(state); return; }
    follow(state); updateTarget(state); syncEdgeScroll(state);
  });
  document.addEventListener("pointerup", event => { if (drag?.pointerId === event.pointerId) finish(drag.outside ? "detach" : "reorder"); });
  document.addEventListener("pointercancel", event => { if (drag?.pointerId === event.pointerId) finish("cancel"); });
  list.addEventListener("lostpointercapture", () => finish("cancel"));
  document.addEventListener("keydown", event => { if (event.key === "Escape" && drag?.active) { event.preventDefault(); finish("cancel"); } }, true);
  // The click that ends a drag must not activate the tab it happens to end on.
  list.addEventListener("click", event => { if (suppressClick) { event.stopPropagation(); event.preventDefault(); } }, true);
}

function installKeyboardMove(list: HTMLElement): void {
  // Keyboard alternative: Alt + Left/Right moves the focused tab one position.
  list.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const element = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>(".editor-tab[data-tab-id]");
    const tabId = element?.dataset.tabId; if (!tabId) return;
    const group = groupOf(tabId);
    const index = group ? group.tabIds.indexOf(tabId) : -1;
    const target = index + (event.key === "ArrowLeft" ? -1 : 1);
    if (!group || index < 0 || target < 0 || target >= group.tabIds.length) return;
    event.preventDefault();
    reorderInGroup(group.id, tabId, target);
    list.querySelector<HTMLElement>(`.editor-tab[data-tab-id="${CSS.escape(tabId)}"] .editor-tab-main`)?.focus();
  });
}

/** Wheel scrolling, dragging and keyboard moves for a strip (the page's strip and the strip of every group). */
export function installTabStripInteractions(list: HTMLElement): void {
  installWheelScroll(list);
  installTabDrag(list);
  installKeyboardMove(list);
}

export function initTabInteractions(): void { installTabStripInteractions($("editorTabList")); }
