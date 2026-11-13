/** Which folders of the project tree are open, as a list that survives restarts (pure). Paths are compared the way the tree compares them. */
import { pathIsInside } from "./project-tree-operations.js";

/** Folders remembered; the least recently changed are forgotten first. */
export const MAX_REMEMBERED_FOLDERS = 3000;

/** A stored value read back: only strings are kept. */
export function parseExpanded(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

const insideAny = (roots: readonly string[], path: string): boolean => roots.some(root => pathIsInside(root, path));

/** The remembered folders that lie inside the given project folders. */
export const openUnder = (list: readonly string[], roots: readonly string[]): string[] => list.filter(path => insideAny(roots, path));

/**
 * The list after the open folders of the current project folders changed: whatever was remembered for other projects stays,
 * the entries inside \`roots\` become exactly \`open\`. The newest are kept when the list is too long.
 */
export function replaceUnder(list: readonly string[], roots: readonly string[], open: Iterable<string>): string[] {
  const others = list.filter(path => !insideAny(roots, path));
  const current = [...open].filter(path => insideAny(roots, path));
  return [...others, ...current].slice(-MAX_REMEMBERED_FOLDERS);
}
