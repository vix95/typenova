/** Expand all / collapse all for the Project tree. */
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { projectTreeState } from "./project-tree-ops";
import { renderProjectTree } from "./project-tree-view";

/** Folders that hold generated or foreign content by the thousand: "expand all" leaves them closed (they open by a click as always). */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git", "target", ".venv", "__pycache__"]);
/** Most folders "expand all" opens, so that a huge project does not stall the window. */
export const MAX_EXPANDED_FOLDERS = 500;

/** Each click gets a number; a listing that finishes after a newer click stops, so the last click decides what is open. */
let latest = 0;

export async function expandAllFolders(): Promise<void> {
  const mine = ++latest;
  const roots = documentState.projectRoots;
  if (!roots.length) return;
  const expanded = projectTreeState.expandedFolders;
  if (roots.length > 1) for (const root of roots) expanded.add(root);
  const queue = [...roots];
  let opened = 0, cut = false;
  while (queue.length && !cut) {
    const directory = queue.shift()!;
    let entries: Awaited<ReturnType<typeof readDir>>;
    try { entries = await readDir(directory); } catch { continue; }
    if (mine !== latest) return;
    for (const entry of entries) {
      if (!entry.isDirectory || SKIPPED_FOLDERS.has(entry.name)) continue;
      if (opened >= MAX_EXPANDED_FOLDERS) { cut = true; break; }
      const full = await join(directory, entry.name);
      if (mine !== latest) return;
      expanded.add(full); queue.push(full); opened++;
    }
  }
  if (mine !== latest) return;
  await renderProjectTree();
  if (cut) showToast(langText(`Rozwinięto ${MAX_EXPANDED_FOLDERS} folderów; pozostałe zostawiono zwinięte.`, `Expanded ${MAX_EXPANDED_FOLDERS} folders; the rest were left collapsed.`));
}

export async function collapseAllFolders(): Promise<void> {
  latest++;
  if (!documentState.projectRoots.length) return;
  projectTreeState.expandedFolders.clear();
  await renderProjectTree();
}
