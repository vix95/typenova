/** Shared state of the editor groups: the layout tree, the groups with their tabs, and which group has the focus. Owned by `groups.ts`; others only read it. */
import type { EditorView } from "@codemirror/view";
import { leaf, type Layout } from "./group-model";

export interface EditorGroup {
  id: string;
  /** The tabs of this group, in the order of its strip. Every tab belongs to exactly one group. */
  tabIds: string[];
  /** The tab this group shows (one of `tabIds`; empty while the group has no tab). */
  activeTabId: string;
  /** The editor of this group; its state is the live state of the active tab. */
  view: EditorView | null;
  /** The element the editor lives in. */
  host: HTMLElement | null;
  /** The element that holds the group (its strip above its editor). */
  el: HTMLElement | null;
  /** The strip made for this group; the first group in the layout uses the strip of the page instead. */
  ownStrip: HTMLElement | null;
  /** The list of tab buttons the group shows now. */
  list: HTMLElement | null;
}

export function newGroup(id: string): EditorGroup {
  return { id, tabIds: [], activeTabId: "", view: null, host: null, el: null, ownStrip: null, list: null };
}

export const groupsState = {
  groups: [] as EditorGroup[],
  layout: leaf("g1") as Layout,
  /** The group in use: its active tab is the active document. */
  focusId: "g1" as string,
  sequence: 1 as number,
};

export function groupById(id: string): EditorGroup | undefined { return groupsState.groups.find(group => group.id === id); }

/** The group that holds a tab. */
export function groupOf(tabId: string): EditorGroup | undefined { return groupsState.groups.find(group => group.tabIds.includes(tabId)); }

/** The group in use. */
export function focusedGroup(): EditorGroup { return groupById(groupsState.focusId) ?? groupsState.groups[0]; }

/** The tab an editor shows. */
export function tabIdInView(target: EditorView): string { return groupsState.groups.find(group => group.view === target)?.activeTabId ?? ""; }
