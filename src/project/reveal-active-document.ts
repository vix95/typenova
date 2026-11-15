/** Keeps the project tree on the document in use: when another document is shown, the folders above it are opened and its row is selected and scrolled into view. A setting turns it off; it is on by default. */
import { documentState } from "../documents/document-state";
import { markProjectTreeSelection } from "../documents/file-actions";
import { rootContaining } from "../filesystem/project-roots";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { projectTreeState } from "./project-tree-ops";
import { renderProjectTree } from "./project-tree-view";
import { foldersBetween } from "./reveal-model";

const FOLLOW_KEY = "typenova.tree.followDocument";

export const followActiveDocument = (): boolean => readPreferenceFlag(FOLLOW_KEY, true);
export const setFollowActiveDocument = (on: boolean): void => writePreferenceFlag(FOLLOW_KEY, on);

/** Opens the folders above the file in the tree's state; true when some were closed (the tree must be drawn again to show them). */
function openFoldersAbove(path: string): boolean {
  const root = rootContaining(documentState.projectRoots, path);
  if (!root) return false;
  const open = new Set([...projectTreeState.expandedFolders].map(normalizedFsPath));
  const closed = foldersBetween(root, path).filter(folder => !open.has(normalizedFsPath(folder)));
  for (const folder of closed) projectTreeState.expandedFolders.add(folder);
  return closed.length > 0;
}

function rowOf(path: string): Element | undefined {
  const wanted = normalizedFsPath(path);
  return [...document.querySelectorAll("#projectFiles [data-file-path]")].find(row => normalizedFsPath((row as HTMLElement).dataset.filePath ?? "") === wanted);
}

export async function revealActiveDocument(): Promise<void> {
  const path = documentState.currentPath;
  // A tree drawn again under a drag in progress would drop the dragged row.
  if (!path || !followActiveDocument() || document.body.classList.contains("tree-pointer-dragging")) return;
  if (openFoldersAbove(path)) await renderProjectTree();
  markProjectTreeSelection(path);
  rowOf(path)?.scrollIntoView({ block: "nearest" });
}

export function installRevealActiveDocument(): void {
  document.addEventListener("typenova:document-shown", () => { void revealActiveDocument(); });
}
