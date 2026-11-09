/** The DOM of the editor groups: the nested splits with their dividers, the element of each group (its strip above its editor), and the overlay that shows where a dragged tab would land. */
import { $ } from "../app/dom";
import { createEditorView } from "../editor/editor-view";
import { setMinimapHost } from "../editor/minimap";
import { langText } from "../i18n/language";
import { dropZone, groupIds, normalizeWeights, resizeWeights, zoneRect, type Layout, type Zone } from "./group-model";
import { focusGroup, persistGroups } from "./groups";
import { groupById, groupsState, type EditorGroup } from "./groups-state";
import { insertionIndex } from "./tab-order";
import { createEditorState, createNewTab, installTabStrip } from "./tabs";
import { installTabStripInteractions } from "./tab-interactions";

const PLUS_ICON = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
/** Slack around a strip in which a dragged tab still counts as being over it. */
const STRIP_SLACK_PX = 6;
let mainStrip: HTMLElement | null = null;

/** The strip that is part of the page (with the new-tab button, the split toggle and the unsaved indicator): the first group uses it. */
function pageStrip(): HTMLElement {
  mainStrip ??= $("editorTabList").closest<HTMLElement>(".editor-tabs")!;
  return mainStrip;
}

function createStrip(group: EditorGroup): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "editor-tabs group-strip";
  const list = document.createElement("div");
  list.className = "editor-tab-list";
  list.setAttribute("role", "tablist");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "new-tab-button";
  add.dataset.newTabIn = group.id;
  add.insertAdjacentHTML("afterbegin", PLUS_ICON);
  add.addEventListener("click", () => { focusGroup(group.id); createNewTab(); });
  strip.append(list, add);
  installTabStrip(list);
  installTabStripInteractions(list);
  return strip;
}

function ensureGroupElement(group: EditorGroup): void {
  if (!group.el) {
    group.el = document.createElement("div");
    group.el.className = "editor-group";
    group.el.setAttribute("role", "group");
    // A group becomes the one in use as soon as it gets the focus or is pressed (typing, clicking, the search box inside it).
    group.el.addEventListener("focusin", () => focusGroup(group.id));
    group.el.addEventListener("pointerdown", () => focusGroup(group.id), true);
  }
  group.el.dataset.group = group.id;
  if (!group.host) { group.host = document.createElement("div"); group.host.className = "editor"; }
  if (!group.view) group.view = createEditorView(createEditorState(""), group.host);
  if (group.host.parentElement !== group.el) group.el.append(group.host);
}

function applyFlex(elements: readonly HTMLElement[], weights: readonly number[]): void {
  elements.forEach((element, index) => { element.style.flex = `${weights[index]} 1 0`; });
}

function labelDivider(divider: HTMLElement): void {
  divider.setAttribute("aria-label", divider.dataset.dir === "row"
    ? langText("Zmień szerokość grup edytora (strzałki w lewo i w prawo)", "Resize the editor groups (left and right arrow keys)")
    : langText("Zmień wysokość grup edytora (strzałki w górę i w dół)", "Resize the editor groups (up and down arrow keys)"));
  divider.dataset.tooltip = langText("Przeciągnij, aby zmienić rozmiar grup", "Drag to resize the groups");
}

function measureViews(): void { for (const group of groupsState.groups) group.view?.requestMeasure(); }

function createDivider(node: Extract<Layout, { kind: "split" }>, index: number, box: HTMLElement, kids: readonly HTMLElement[]): HTMLElement {
  const row = node.dir === "row";
  const divider = document.createElement("div");
  divider.className = "editor-divider";
  divider.dataset.dir = node.dir;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", row ? "vertical" : "horizontal");
  divider.tabIndex = 0;
  labelDivider(divider);
  const move = (delta: number) => {
    node.weights = resizeWeights(node.weights, index, delta);
    applyFlex(kids, node.weights);
    divider.setAttribute("aria-valuenow", String(Math.round(node.weights[index] * 100)));
    measureViews();
  };
  divider.setAttribute("aria-valuenow", String(Math.round(node.weights[index] * 100)));
  let pointer: number | null = null, last = 0;
  divider.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    last = row ? event.clientX : event.clientY;
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-panels");
  });
  divider.addEventListener("pointermove", event => {
    if (pointer !== event.pointerId) return;
    const rect = box.getBoundingClientRect();
    const size = row ? rect.width : rect.height, at = row ? event.clientX : event.clientY;
    if (size > 0) move((at - last) / size);
    last = at;
  });
  const finish = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    pointer = null;
    document.body.classList.remove("resizing-panels");
    persistGroups();
  };
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
  divider.addEventListener("keydown", event => {
    const back = row ? "ArrowLeft" : "ArrowUp", forward = row ? "ArrowRight" : "ArrowDown";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    move(event.key === forward ? 0.02 : -0.02);
    persistGroups();
  });
  return divider;
}

function buildNode(node: Layout): HTMLElement {
  if (node.kind === "group") return groupById(node.id)!.el!;
  node.weights = normalizeWeights(node.weights);
  const box = document.createElement("div");
  box.className = "editor-split";
  box.dataset.dir = node.dir;
  const kids = node.children.map(buildNode);
  applyFlex(kids, node.weights);
  kids.forEach((kid, index) => {
    box.append(kid);
    if (index < kids.length - 1) box.append(createDivider(node, index, box, kids));
  });
  return box;
}

/** Draws the layout: one element per group inside nested splits. The editors keep their documents; their scroll positions are put back, because moving an element in the page resets them. */
export function renderLayout(): void {
  const { groups, layout } = groupsState;
  const multi = groups.length > 1;
  const scrolls = new Map(groups.map(group => [group.id, group.view?.scrollDOM.scrollTop ?? 0]));
  for (const group of groups) ensureGroupElement(group);
  const root = buildNode(layout);
  // The top element fills the whole area. A group that was a child of a split keeps the share it had there (an inline flex), which left only half of the area used after the groups were merged.
  root.style.flex = "1 1 0";
  const container = $("editorGroups");
  const ownerId = groupIds(layout)[0];
  for (const group of groups) {
    const strip = !multi ? null : group.id === ownerId ? pageStrip() : (group.ownStrip ??= createStrip(group));
    // A group has one strip: its own, or the page's when it is the first one.
    if (group.ownStrip && group.ownStrip !== strip) group.ownStrip.remove();
    if (strip) group.el!.prepend(strip);
    group.list = (strip ?? pageStrip()).querySelector<HTMLElement>(".editor-tab-list");
  }
  // With one group the strip stays where it always was, above the formatting toolbar.
  if (!multi) { $("editorPane").prepend(pageStrip()); groups[0].list = $("editorTabList"); }
  container.replaceChildren(root);
  container.classList.toggle("is-multi", multi);
  setMinimapHost(multi ? null : groups[0].host);
  requestAnimationFrame(() => {
    for (const group of groups) { const top = scrolls.get(group.id); if (group.view && top) group.view.scrollDOM.scrollTop = top; }
    measureViews();
  });
}

/** Which group has the focus, the labels of the dividers and strips, and the split toggle. */
export function refreshGroupsUi(): void {
  const multi = groupsState.groups.length > 1;
  groupsState.groups.forEach((group, index) => {
    group.el?.classList.toggle("is-focused", multi && group.id === groupsState.focusId);
    group.el?.setAttribute("aria-label", langText(`Grupa edytora ${index + 1} z ${groupsState.groups.length}`, `Editor group ${index + 1} of ${groupsState.groups.length}`));
    const add = group.ownStrip?.querySelector<HTMLElement>(".new-tab-button");
    if (add) { const text = langText("Nowy dokument w tej grupie", "New document in this group"); add.dataset.tooltip = text; add.setAttribute("aria-label", text); }
    group.ownStrip?.querySelector(".editor-tab-list")?.setAttribute("aria-label", langText("Otwarte dokumenty tej grupy", "Open documents of this group"));
  });
  document.querySelectorAll<HTMLElement>(".editor-divider").forEach(labelDivider);
  const toggle = $("splitToggle");
  toggle.dataset.tooltip = multi ? langText("Scal grupy edytora w jedną (Ctrl+\\)", "Merge the editor groups into one (Ctrl+\\)") : langText("Podziel edytor w prawo (Ctrl+\\)", "Split the editor to the right (Ctrl+\\)");
  toggle.setAttribute("aria-label", multi ? langText("Scal grupy edytora w jedną", "Merge the editor groups into one") : langText("Podziel edytor w prawo", "Split the editor to the right"));
  toggle.setAttribute("aria-pressed", String(multi));
  toggle.classList.toggle("selected", multi);
}

// ---- Where a dragged tab would land

export type DropTarget = { kind: "strip"; groupId: string; slot: number } | { kind: "zone"; groupId: string; zone: Zone };

const contains = (rect: DOMRect, x: number, y: number, slack = 0) => x >= rect.left && x <= rect.right && y >= rect.top - slack && y <= rect.bottom + slack;

/** What a tab released at a point would do: take a place in a strip, or join a group / open a new one beside it. Null when the point is over neither. */
export function dropTargetAt(x: number, y: number, draggedTabId: string): DropTarget | null {
  for (const group of groupsState.groups) {
    const strip = group.list?.closest<HTMLElement>(".editor-tabs");
    if (strip && contains(strip.getBoundingClientRect(), x, y, STRIP_SLACK_PX)) {
      const tabs = Array.from(group.list!.querySelectorAll<HTMLElement>(":scope > .editor-tab[data-tab-id]")).filter(tab => tab.dataset.tabId !== draggedTabId);
      const middles = tabs.map(tab => { const box = tab.getBoundingClientRect(); return box.left + box.width / 2; });
      return { kind: "strip", groupId: group.id, slot: insertionIndex(middles, x) };
    }
    const host = group.host?.getBoundingClientRect();
    if (host && contains(host, x, y)) return { kind: "zone", groupId: group.id, zone: dropZone(host.width, host.height, x - host.left, y - host.top) };
  }
  return null;
}

let overlay: HTMLElement | null = null;

/** Shows where the tab would land: the half of the group beside which a new group would open, or the whole group. */
export function showDropZone(groupId: string, zone: Zone): void {
  const host = groupById(groupId)?.host?.getBoundingClientRect();
  if (!host) { hideDropZone(); return; }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "group-drop-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.append(overlay);
  }
  const part = zoneRect(zone);
  overlay.style.left = `${host.left + part.left * host.width}px`;
  overlay.style.top = `${host.top + part.top * host.height}px`;
  overlay.style.width = `${part.width * host.width}px`;
  overlay.style.height = `${part.height * host.height}px`;
  overlay.dataset.zone = zone;
  overlay.textContent = zone === "center" ? langText("Upuść, aby otworzyć w tej grupie", "Drop to open in this group")
    : langText("Upuść, aby otworzyć w nowej grupie", "Drop to open in a new group");
}

export function hideDropZone(): void { overlay?.remove(); overlay = null; }
