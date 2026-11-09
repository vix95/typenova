/** The editor groups: the editor area is split into groups, each with its own tabs and its own editor. `view` (see `editor/editor-view.ts`) is always the editor of the group in use, so everything else in the application keeps working on "the active document". A document belongs to exactly one group, so there is one live editor state per document. */
import { EditorView } from "@codemirror/view";
import { $ } from "../app/dom";
import { destroyEditorView, setActiveView, view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { documentState } from "./document-state";
import { groupIds, leaf, MAX_GROUPS, neighborOf, parseGroups, pruneStored, removeFromLayout, replacementTab, serializeGroups, splitLayout, type Side } from "./group-model";
import { refreshGroupsUi, renderLayout } from "./groups-dom";
import { focusedGroup, groupById, groupOf, groupsState, newGroup, type EditorGroup } from "./groups-state";
import { sameSessionPath, type ViewPosition } from "./session";
import { moveItem } from "./tab-order";
import { activeTab, addTabInBackground, loadStateIntoView, renderTabs, saveActiveTab, showTab } from "./tabs";
import { rememberViewPosition } from "./view-position";

const STORAGE_KEY = "typenova.groups.v1";
const findTab = (id: string) => documentState.tabs.find(tab => tab.id === id);

/** While tabs are being closed they are already out of their groups but still in the list of tabs, and must not be taken back in. */
let closing: ReadonlySet<string> = new Set();

function scrollToLine(target: EditorView, position: ViewPosition | null | undefined): void {
  if (!position || position.editorLine <= 1) return;
  const doc = target.state.doc;
  target.dispatch({ effects: EditorView.scrollIntoView(doc.line(Math.min(position.editorLine, doc.lines)).from, { y: "start" }) });
}

/** What a group's editor holds goes back to the tab it shows (the groups that are not in use keep their text only there and in their editor). */
function syncGroupTab(group: EditorGroup): void {
  const tab = findTab(group.activeTabId);
  if (tab && group.view) tab.state = group.view.state;
}

function syncOtherGroups(): void { for (const group of groupsState.groups) if (group.id !== groupsState.focusId) syncGroupTab(group); }

/** Puts a tab into the editor of a group and makes it the one the group shows. */
function showInGroup(group: EditorGroup, tabId: string): void {
  const tab = findTab(tabId);
  if (!tab || !group.view) return;
  group.activeTabId = tabId;
  loadStateIntoView(group.view, tab);
  scrollToLine(group.view, tab.viewPosition);
}

/** A tab became the one in use: the group in use shows it (and holds it). */
export function noteTabShown(tabId: string): void {
  const group = focusedGroup();
  if (!group) return;
  if (!group.tabIds.includes(tabId)) { groupOf(tabId)?.tabIds.splice(groupOf(tabId)!.tabIds.indexOf(tabId), 1); group.tabIds.push(tabId); }
  group.activeTabId = tabId;
}

function removeGroup(group: EditorGroup): void {
  groupsState.groups = groupsState.groups.filter(item => item !== group);
  groupsState.layout = removeFromLayout(groupsState.layout, group.id) ?? groupsState.layout;
  if (group.view) destroyEditorView(group.view);
  group.el?.remove();
}

/** Makes the groups agree with the tabs: tabs that are gone leave their group, tabs without a group join the group in use, and every group shows one of its tabs. */
export function reconcileGroups(): void {
  if (!groupsState.groups.length) return;
  const present = new Set(documentState.tabs.map(tab => tab.id));
  for (const group of groupsState.groups) group.tabIds = group.tabIds.filter(id => present.has(id));
  const owned = new Set(groupsState.groups.flatMap(group => group.tabIds));
  const home = focusedGroup();
  for (const tab of documentState.tabs) if (!owned.has(tab.id) && !closing.has(tab.id)) home.tabIds.push(tab.id);
  for (const group of groupsState.groups) if (!group.tabIds.includes(group.activeTabId)) group.activeTabId = group.tabIds[0] ?? "";
}

/** The list of tabs follows the order the user sees: group by group, each in the order of its strip. */
export function orderTabs(): void {
  const order = groupIds(groupsState.layout).flatMap(id => groupById(id)?.tabIds ?? []);
  const known = new Set(order);
  const byId = new Map(documentState.tabs.map(tab => [tab.id, tab]));
  const sorted = order.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  documentState.tabs = [...sorted, ...documentState.tabs.filter(tab => !known.has(tab.id))];
}

/** Makes a group the one in use: its active tab becomes the active document. */
export function focusGroup(id: string): void {
  const next = groupById(id);
  if (!next?.view || id === groupsState.focusId) return;
  const leaving = activeTab();
  if (leaving) rememberViewPosition(leaving);
  saveActiveTab();
  groupsState.focusId = id;
  setActiveView(next.view);
  const tab = findTab(next.activeTabId);
  if (tab) showTab(tab, false);
  refreshGroupsUi();
  persistGroups();
}

/** Moves the tab to the next or the previous group. */
export function focusNeighborGroup(step: 1 | -1): void {
  const id = neighborOf(groupsState.layout, groupsState.focusId, step);
  if (!id) return;
  focusGroup(id);
  groupById(id)?.view?.focus();
}

export function reorderInGroup(groupId: string, tabId: string, slot: number): void {
  const group = groupById(groupId);
  if (!group) return;
  const next = moveItem(group.tabIds, id => id === tabId, slot);
  if (next.every((id, index) => id === group.tabIds[index])) return;
  group.tabIds = next;
  orderTabs();
  renderTabs();
}

/** Takes a tab to another group (at a slot of its strip) and makes that group the one in use. */
export function moveTabToGroup(tabId: string, toId: string, slot?: number): void {
  const tab = findTab(tabId), from = groupOf(tabId), to = groupById(toId);
  if (!tab || !to?.view) return;
  if (from === to) { reorderInGroup(toId, tabId, slot ?? to.tabIds.length); focusGroup(toId); return; }
  saveActiveTab();
  syncOtherGroups();
  if (from) {
    const at = from.tabIds.indexOf(tabId);
    from.tabIds.splice(at, 1);
    if (from.activeTabId === tabId) {
      const next = replacementTab(from.tabIds, at);
      if (next) showInGroup(from, next); else from.activeTabId = "";
    }
  }
  to.tabIds.splice(slot === undefined ? to.tabIds.length : Math.max(0, Math.min(to.tabIds.length, slot)), 0, tabId);
  showInGroup(to, tabId);
  groupsState.focusId = to.id;
  setActiveView(to.view);
  const emptied = from && !from.tabIds.length;
  if (from && emptied) removeGroup(from);
  orderTabs();
  renderLayout();
  showTab(tab, false);
  refreshGroupsUi();
  persistGroups();
  to.view.focus();
}

/** Opens a tab in a new group beside a group (a group with only that tab gets an empty document, so it is not left empty). */
export function splitWithTab(tabId: string, targetId: string, side: Side): void {
  const target = groupById(targetId), tab = findTab(tabId);
  if (!target || !tab) return;
  if (groupsState.groups.length >= MAX_GROUPS) {
    showToast(langText(`Można mieć najwyżej ${MAX_GROUPS} grupy edytora.`, `There can be at most ${MAX_GROUPS} editor groups.`));
    return;
  }
  const source = groupOf(tabId);
  if (source === target && target.tabIds.length < 2) target.tabIds.push(addTabInBackground(langText("Bez tytułu.md", "Untitled.md")).id);
  saveActiveTab();
  syncOtherGroups();
  const created = newGroup(`g${++groupsState.sequence}`);
  groupsState.groups.push(created);
  groupsState.layout = splitLayout(groupsState.layout, targetId, side, created.id);
  renderLayout();
  moveTabToGroup(tabId, created.id);
}

/** The "split" command: with one group, opens the next tab (or an empty document) in a new group on the right; with several, merges them. */
export function toggleSplit(): void {
  if (groupsState.groups.length > 1) { mergeGroups(); return; }
  const group = focusedGroup();
  const index = group.tabIds.indexOf(group.activeTabId);
  const other = group.tabIds[index + 1] ?? group.tabIds[index - 1];
  const tabId = other ?? addTabInBackground(langText("Bez tytułu.md", "Untitled.md")).id;
  splitWithTab(tabId, group.id, "right");
}

/** Puts the tabs of every group into the group in use and removes the other groups. */
export function mergeGroups(): void {
  if (groupsState.groups.length < 2) return;
  saveActiveTab();
  syncOtherGroups();
  const keep = focusedGroup();
  for (const group of [...groupsState.groups]) {
    if (group === keep) continue;
    keep.tabIds.push(...group.tabIds);
    removeGroup(group);
  }
  orderTabs();
  renderLayout();
  renderTabs();
  refreshGroupsUi();
  persistGroups();
  keep.view?.focus();
}

/**
 * Tabs are about to close: they leave their groups first. A group that shows one of them shows its neighbour instead,
 * and a group left empty disappears (the last group stays and gets a new document from the caller).
 */
export function detachTabsFromGroups(ids: ReadonlySet<string>): void {
  closing = ids;
  try {
    saveActiveTab();
    syncOtherGroups();
    let layoutChanged = false;
    for (const group of [...groupsState.groups]) {
      const before = group.tabIds;
      if (!before.some(id => ids.has(id))) continue;
      const activeIndex = before.indexOf(group.activeTabId);
      const wasActive = ids.has(group.activeTabId);
      group.tabIds = before.filter(id => !ids.has(id));
      if (!group.tabIds.length) {
        if (groupsState.groups.length > 1) { removeGroup(group); layoutChanged = true; }
        continue;
      }
      if (wasActive) showInGroup(group, replacementTab(group.tabIds, activeIndex - before.slice(0, activeIndex).filter(id => ids.has(id)).length));
    }
    if (!groupById(groupsState.focusId)) { groupsState.focusId = groupsState.groups[0].id; setActiveView(groupsState.groups[0].view!); }
    if (layoutChanged) renderLayout();
    const next = findTab(focusedGroup().activeTabId);
    if (next && next.id !== documentState.activeTabId) showTab(next, false);
    refreshGroupsUi();
  } finally { closing = new Set(); }
}

// ---- Remembering the groups between sessions

export function persistGroups(): void {
  try {
    if (groupsState.groups.length < 2) { localStorage.removeItem(STORAGE_KEY); return; }
    const groups: Record<string, { paths: string[]; active: string }> = {};
    for (const group of groupsState.groups) {
      const paths = group.tabIds.flatMap(id => { const path = findTab(id)?.path; return path ? [path] : []; });
      groups[group.id] = { paths, active: findTab(group.activeTabId)?.path ?? "" };
    }
    localStorage.setItem(STORAGE_KEY, serializeGroups({ version: 1, layout: groupsState.layout, groups, focus: groupsState.focusId }));
  } catch { /* storage unavailable: the groups are simply not remembered */ }
}

/** After the open documents were restored: arranges them in groups again when the program was closed with several groups. */
export function restoreGroupsAtStartup(): void {
  let stored = null;
  try { stored = parseGroups(localStorage.getItem(STORAGE_KEY)); } catch { /* nothing remembered */ }
  if (!stored || groupsState.groups.length !== 1) return;
  const open = (path: string) => documentState.tabs.some(tab => sameSessionPath(tab.path, path));
  const pruned = pruneStored(stored, open);
  if (!pruned) return;
  saveActiveTab();
  const ids = groupIds(pruned.layout);
  const first = groupsState.groups[0];
  const restored = ids.map((id, index) => {
    const group = index === 0 ? first : newGroup(id);
    group.id = id;
    group.tabIds = pruned.groups[id].paths.flatMap(path => { const tab = documentState.tabs.find(item => sameSessionPath(item.path, path)); return tab ? [tab.id] : []; });
    const wanted = documentState.tabs.find(item => sameSessionPath(item.path, pruned.groups[id].active));
    group.activeTabId = wanted && group.tabIds.includes(wanted.id) ? wanted.id : group.tabIds[0];
    return group;
  });
  groupsState.groups = restored;
  groupsState.layout = pruned.layout;
  groupsState.sequence = Math.max(groupsState.sequence, ...ids.map(id => Number(id.replace(/\D/g, "")) || 0));
  groupsState.focusId = ids[0];
  renderLayout();
  for (const group of restored) if (group !== first) showInGroup(group, group.activeTabId);
  showInGroup(first, first.activeTabId);
  groupsState.focusId = pruned.focus;
  const focused = focusedGroup();
  setActiveView(focused.view!);
  const tab = findTab(focused.activeTabId);
  if (tab) showTab(tab, false);
  orderTabs();
  renderTabs();
  refreshGroupsUi();
}

// ---- Wiring

export function initGroups(): void {
  const first = newGroup("g1");
  first.view = view;
  first.host = $("editor");
  first.tabIds = documentState.tabs.map(tab => tab.id);
  first.activeTabId = documentState.activeTabId;
  groupsState.groups = [first];
  groupsState.layout = leaf("g1");
  groupsState.focusId = "g1";
  renderLayout();
  $("splitToggle").addEventListener("click", toggleSplit);
  $("menuViewSplit").addEventListener("click", toggleSplit);
  document.addEventListener("keydown", event => {
    const backslash = event.key === "\\" || event.code === "Backslash";
    // AltGr counts as Ctrl+Alt on Windows, so a plain Ctrl is required.
    if (!backslash || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    toggleSplit();
  });
  document.addEventListener("typenova:language-changed", refreshGroupsUi);
  window.addEventListener("resize", () => { for (const group of groupsState.groups) group.view?.requestMeasure(); });
  refreshGroupsUi();
}
