/** Pure helpers for the set of folders shown in the project tree. */
import { normalizedFsPath, pathIsInside } from "./project-tree-operations.js";

export type AddProjectRootResult =
  | { status: "added"; roots: string[] }
  | { status: "duplicate"; roots: string[] }
  | { status: "inside"; roots: string[]; existing: string }
  | { status: "contains"; roots: string[]; existing: string };

/** The open root that contains `path` (the deepest one if roots were ever nested), or null. */
export function rootContaining(roots: readonly string[], path: string): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (!pathIsInside(root, path)) continue;
    if (best === null || normalizedFsPath(root).length > normalizedFsPath(best).length) best = root;
  }
  return best;
}

export function isProjectRoot(roots: readonly string[], path: string): boolean {
  const target = normalizedFsPath(path);
  return roots.some(root => normalizedFsPath(root) === target);
}

/**
 * Adds a folder to the tree. The same folder, a folder inside an open one and a folder that contains an open one are
 * refused (the result says why) because overlapping roots would show the same files twice.
 */
export function addProjectRoot(roots: readonly string[], path: string): AddProjectRootResult {
  const current = [...roots];
  if (isProjectRoot(current, path)) return { status: "duplicate", roots: current };
  const parent = current.find(root => pathIsInside(root, path));
  if (parent) return { status: "inside", roots: current, existing: parent };
  const child = current.find(root => pathIsInside(path, root));
  if (child) return { status: "contains", roots: current, existing: child };
  return { status: "added", roots: [...current, path] };
}

export function removeProjectRoot(roots: readonly string[], path: string): string[] {
  const target = normalizedFsPath(path);
  return roots.filter(root => normalizedFsPath(root) !== target);
}

/** Reads the stored root list; falls back to the single-root value written by earlier versions. */
export function parseStoredProjectRoots(raw: string | null, legacyRoot: string | null): string[] {
  const roots: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) for (const item of parsed) if (typeof item === "string" && item.trim()) roots.push(item);
  } catch { /* fall back to the legacy value */ }
  if (!roots.length && legacyRoot?.trim()) roots.push(legacyRoot);
  const result: string[] = [];
  for (const root of roots) if (!isProjectRoot(result, root)) result.push(root);
  return result;
}
