/** The folders shown in the project tree: shared state, persistence and lookups. */
import { documentState } from "../documents/document-state";
import { isProjectRoot, parseStoredProjectRoots, rootContaining } from "../filesystem/project-roots";

const ROOTS_STORAGE_KEY = "typenova.projectRoots";
const LEGACY_ROOT_STORAGE_KEY = "typenova.projectRoot";
const GRAPH_ROOT_STORAGE_KEY = "typenova.brain.selectedProjectRoot";

/** Open folders in tree order. `documentState.projectRoot` always mirrors the first one (null when none is open). */
export function getProjectRoots(): readonly string[] { return documentState.projectRoots; }
export function projectRootFor(path: string): string | null { return rootContaining(documentState.projectRoots, path); }
export function isOpenProjectRoot(path: string): boolean { return isProjectRoot(documentState.projectRoots, path); }
/** True when exactly one folder is open, so a single folder can be named as "the" project (header drops, blank-area menu). */
export function hasSingleProjectRoot(): boolean { return documentState.projectRoots.length === 1; }

/** Identifies the current set of folders for the graph's remembered file selection. */
export function projectRootsKey(roots: readonly string[] = documentState.projectRoots): string { return roots.join("|"); }

export function setProjectRoots(roots: readonly string[]): void {
  documentState.projectRoots = [...roots];
  documentState.projectRoot = roots[0] ?? null;
  try {
    if (roots.length) {
      localStorage.setItem(ROOTS_STORAGE_KEY, JSON.stringify(roots));
      localStorage.setItem(LEGACY_ROOT_STORAGE_KEY, roots[0]);
      localStorage.setItem(GRAPH_ROOT_STORAGE_KEY, projectRootsKey(roots));
    } else {
      localStorage.removeItem(ROOTS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_ROOT_STORAGE_KEY);
    }
  } catch { /* storage unavailable: the tree still works for this session */ }
}

export function rememberedProjectRoots(): string[] {
  try { return parseStoredProjectRoots(localStorage.getItem(ROOTS_STORAGE_KEY), localStorage.getItem(LEGACY_ROOT_STORAGE_KEY)); }
  catch { return []; }
}
