/** Editor groups: the editor area is a tree of splits whose leaves are groups, and each group has its own tabs. This is the pure part: the layout tree, where a dragged tab would land, resizing, and what is remembered between sessions. No DOM. */

export type Dir = "row" | "column";
export type Side = "left" | "right" | "top" | "bottom";
export type Zone = "center" | Side;

export type Layout = { kind: "group"; id: string } | { kind: "split"; dir: Dir; children: Layout[]; weights: number[] };

/** More groups than this leave each one too small to use. */
export const MAX_GROUPS = 4;
export const MIN_SHARE = 0.12;
/** The part of a group's width or height, from each edge, in which a dragged tab means "open next to this group". */
export const EDGE_SHARE = 0.25;

export const leaf = (id: string): Layout => ({ kind: "group", id });

/** The ids of the groups in visual order (left to right, top to bottom). */
export function groupIds(layout: Layout): string[] {
  return layout.kind === "group" ? [layout.id] : layout.children.flatMap(groupIds);
}

export function sideDirection(side: Side): { dir: Dir; before: boolean } {
  return { dir: side === "left" || side === "right" ? "row" : "column", before: side === "left" || side === "top" };
}

const equalWeights = (count: number): number[] => Array.from({ length: count }, () => 1 / count);

/** Brings weights to shares that sum to 1, each at least MIN_SHARE. */
export function normalizeWeights(weights: readonly number[]): number[] {
  const count = weights.length;
  if (!count) return [];
  const clean = weights.map(value => (Number.isFinite(value) && value > 0 ? value : 0));
  const sum = clean.reduce((total, value) => total + value, 0);
  if (sum <= 0) return equalWeights(count);
  let shares = clean.map(value => Math.max(MIN_SHARE, value / sum));
  const total = shares.reduce((a, b) => a + b, 0);
  shares = shares.map(value => value / total);
  return shares;
}

/** A new group `newId` beside the group `targetId`, on the given side. The target keeps half of its room. */
export function splitLayout(layout: Layout, targetId: string, side: Side, newId: string): Layout {
  const { dir, before } = sideDirection(side);
  const place = (node: Layout): Layout => {
    if (node.kind === "group") {
      if (node.id !== targetId) return node;
      return { kind: "split", dir, children: before ? [leaf(newId), node] : [node, leaf(newId)], weights: [0.5, 0.5] };
    }
    const index = node.children.findIndex(child => child.kind === "group" && child.id === targetId);
    if (index >= 0 && node.dir === dir) {
      // Beside a group of a split that runs the same way: the target gives half of its share to the newcomer.
      const children = [...node.children], weights = [...node.weights];
      const half = weights[index] / 2;
      weights[index] = half;
      children.splice(before ? index : index + 1, 0, leaf(newId));
      weights.splice(before ? index : index + 1, 0, half);
      return { kind: "split", dir, children, weights: normalizeWeights(weights) };
    }
    return { ...node, children: node.children.map(place) };
  };
  return place(layout);
}

/** The layout without a group; a split left with one child is replaced by it, and a split inside a split that runs the same way is merged into it. Null when nothing is left. */
export function removeFromLayout(layout: Layout, id: string): Layout | null {
  if (layout.kind === "group") return layout.id === id ? null : layout;
  const children: Layout[] = [], weights: number[] = [];
  layout.children.forEach((child, index) => {
    const rest = removeFromLayout(child, id);
    if (rest) { children.push(rest); weights.push(layout.weights[index]); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const flatChildren: Layout[] = [], flatWeights: number[] = [];
  children.forEach((child, index) => {
    if (child.kind === "split" && child.dir === layout.dir) {
      const share = normalizeWeights(weights)[index];
      child.children.forEach((inner, innerIndex) => { flatChildren.push(inner); flatWeights.push(share * child.weights[innerIndex]); });
    } else { flatChildren.push(child); flatWeights.push(weights[index]); }
  });
  return { kind: "split", dir: layout.dir, children: flatChildren, weights: normalizeWeights(flatWeights) };
}

/** The group after (`step` 1) or before (-1) a group in visual order, wrapping around; null when there is only one group. */
export function neighborOf(layout: Layout, id: string, step: 1 | -1): string | null {
  const ids = groupIds(layout);
  const index = ids.indexOf(id);
  if (ids.length < 2 || index < 0) return null;
  return ids[(index + step + ids.length) % ids.length];
}

/** What a tab dropped at a point of a group would do: join the group (centre) or open a new group on a side. The nearest edge wins in a corner. */
export function dropZone(width: number, height: number, x: number, y: number): Zone {
  if (width <= 0 || height <= 0) return "center";
  const fx = x / width, fy = y / height;
  const nearest: { side: Side; distance: number }[] = [
    { side: "left", distance: fx }, { side: "right", distance: 1 - fx }, { side: "top", distance: fy }, { side: "bottom", distance: 1 - fy },
  ];
  const best = nearest.reduce((a, b) => (b.distance < a.distance ? b : a));
  return best.distance < EDGE_SHARE ? best.side : "center";
}

/** The rectangle (as fractions of the group) that shows where a tab would land for a zone. */
export function zoneRect(zone: Zone): { left: number; top: number; width: number; height: number } {
  switch (zone) {
    case "left": return { left: 0, top: 0, width: 0.5, height: 1 };
    case "right": return { left: 0.5, top: 0, width: 0.5, height: 1 };
    case "top": return { left: 0, top: 0, width: 1, height: 0.5 };
    case "bottom": return { left: 0, top: 0.5, width: 1, height: 0.5 };
    default: return { left: 0, top: 0, width: 1, height: 1 };
  }
}

/** Shares after a divider between `index` and `index + 1` moved by `delta` (a fraction of the split), keeping both neighbours at least MIN_SHARE. */
export function resizeWeights(weights: readonly number[], index: number, delta: number): number[] {
  if (index < 0 || index >= weights.length - 1) return [...weights];
  const total = weights[index] + weights[index + 1];
  const first = Math.min(total - MIN_SHARE, Math.max(MIN_SHARE, weights[index] + delta));
  const next = [...weights];
  next[index] = first;
  next[index + 1] = total - first;
  return next;
}

/** The tab to show in a group after one of its tabs is gone: the neighbour that took its place, else the one before it; "" when none is left. */
export function replacementTab(tabIds: readonly string[], removedIndex: number): string {
  return tabIds[removedIndex] ?? tabIds[removedIndex - 1] ?? "";
}

/** What a group needs to be remembered: the files of its tabs and the one shown. */
export interface StoredGroup { paths: string[]; active: string }
export interface StoredGroups { layout: Layout; groups: Record<string, StoredGroup>; focus: string; version: 1 }

export function serializeGroups(stored: StoredGroups | null): string { return stored ? JSON.stringify(stored) : ""; }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseLayout(value: unknown, depth = 0): Layout | null {
  if (!isRecord(value) || depth > 6) return null;
  if (value.kind === "group") return typeof value.id === "string" && value.id ? leaf(value.id) : null;
  if (value.kind !== "split" || (value.dir !== "row" && value.dir !== "column") || !Array.isArray(value.children) || !Array.isArray(value.weights)) return null;
  const children = value.children.map(child => parseLayout(child, depth + 1));
  if (children.length < 2 || children.length !== value.weights.length || children.some(child => child === null)) return null;
  return { kind: "split", dir: value.dir, children: children as Layout[], weights: normalizeWeights(value.weights.map(Number)) };
}

export function parseGroups(raw: string | null | undefined): StoredGroups | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.groups)) return null;
    const layout = parseLayout(value.layout);
    if (!layout) return null;
    const groups: Record<string, StoredGroup> = {};
    for (const [id, item] of Object.entries(value.groups)) {
      if (!isRecord(item) || !Array.isArray(item.paths)) continue;
      groups[id] = { paths: item.paths.filter((path): path is string => typeof path === "string" && path !== ""), active: typeof item.active === "string" ? item.active : "" };
    }
    const ids = groupIds(layout);
    if (ids.length < 2 || ids.length > MAX_GROUPS || ids.some(id => !groups[id])) return null;
    return { version: 1, layout, groups, focus: typeof value.focus === "string" && ids.includes(value.focus) ? value.focus : ids[0] };
  } catch { return null; }
}

/** The stored layout reduced to what can be restored: only open files are kept, and groups left without any tab disappear. Null when fewer than two groups remain. */
export function pruneStored(stored: StoredGroups, isOpen: (path: string) => boolean): StoredGroups | null {
  let layout: Layout | null = stored.layout;
  const groups: Record<string, StoredGroup> = {};
  for (const id of groupIds(stored.layout)) {
    const paths = stored.groups[id].paths.filter(isOpen);
    if (!paths.length) { layout = layout ? removeFromLayout(layout, id) : null; continue; }
    groups[id] = { paths, active: paths.includes(stored.groups[id].active) ? stored.groups[id].active : paths[0] };
  }
  if (!layout) return null;
  const ids = groupIds(layout);
  if (ids.length < 2) return null;
  return { version: 1, layout, groups, focus: ids.includes(stored.focus) ? stored.focus : ids[0] };
}
